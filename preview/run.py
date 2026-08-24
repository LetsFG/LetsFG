"""Run the LetsFG Omarchy plugin's real QML in a window, without Omarchy.

    python preview/run.py                      # interactive window
    python preview/run.py --screenshot out.png # render, grab, exit
    python preview/run.py --strict             # exit non-zero on any QML warning

Omarchy's shell is Quickshell on Wayland (wlr-layer-shell), so it cannot run on
Windows or macOS. But the plugin is ordinary QML, and its imports are stubbed in
preview/stubs -- so the real BarWidget.qml and Panel.qml can be loaded by any
Qt 6 QML engine. That is enough to prove the QML parses, every property and
signal name resolves, the bindings evaluate and the JavaScript runs.

Credentials: if LETSFG_BEARER_TOKEN is set, it is written into a sandbox
   <preview>/home/.letsfg/config.json
and HOME is redirected there for the QML only. The plugin reads it through its
normal FileView path with no code changes, and your real ~/.letsfg is never
touched or read. Without the variable, the panel renders its no-token state --
which is also worth looking at.
"""
import argparse
import json
import re
import os
import shutil
import sys
import time

from PySide6.QtCore import (QMetaObject, QObject, Q_ARG, QTimer, QUrl, Slot,
                            qInstallMessageHandler, QtMsgType)
from PySide6.QtGui import QGuiApplication
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtQuickControls2 import QQuickStyle

PREVIEW_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.dirname(PREVIEW_DIR)
STUBS_DIR = os.path.join(PREVIEW_DIR, "stubs")
SANDBOX_HOME = os.path.join(PREVIEW_DIR, "home")

# Collected so a QML error cannot scroll past unnoticed -- the entire point of
# running this is to find them.
MESSAGES = []


def _handler(mode, context, message):
    label = {
        QtMsgType.QtDebugMsg: "debug",
        QtMsgType.QtInfoMsg: "info",
        QtMsgType.QtWarningMsg: "WARNING",
        QtMsgType.QtCriticalMsg: "CRITICAL",
        QtMsgType.QtFatalMsg: "FATAL",
    }.get(mode, "msg")
    MESSAGES.append((label, message))
    print("[%s] %s" % (label, message), file=sys.stderr)


class Host(QObject):
    """The bridge the stub modules call into: environment and file reads."""

    def __init__(self, home):
        super().__init__()
        self._home = home

    @Slot(str, result=str)
    def env(self, name):
        # HOME is redirected so the plugin's own token path resolves into the
        # sandbox. Everything else falls through to the real environment.
        if name == "HOME":
            return self._home
        return os.environ.get(name, "")

    @Slot(str, result="QVariant")
    def readFile(self, path):
        # None maps to a QML null, which the FileView stub reports as a load
        # failure -- the same shape as a missing file in the real one.
        #
        # Qt.resolvedUrl() yields "file:///C:/..." on Windows, and the plugin
        # strips the scheme to get the plain path FileView wants. That leaves
        # "/C:/Users/..." here, which is right on Linux (the real target) and
        # unopenable on Windows -- so the harness, not the plugin, fixes it.
        if re.match(r"^/[A-Za-z]:/", path):
            path = path[1:]
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return fh.read()
        except OSError:
            return None

    grab_result = None

    @Slot(str, bool)
    def grabFinished(self, path, ok):
        Host.grab_result = (path, ok)

    preset_route = None

    @Slot(result="QVariant")
    def preset(self):
        if not Host.preset_route:
            return {}
        return {"defaultOrigin": Host.preset_route[0].upper(),
                "defaultDestination": Host.preset_route[1].upper()}

    @Slot(str, result=str)
    def statePath(self, rel):
        # Stands in for Quickshell's per-shell state dir, inside the sandbox so
        # a preview never writes a token into the real one.
        d = os.path.join(SANDBOX_HOME, "state")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, rel).replace(os.sep, "/")

    @Slot(str, str, result=bool)
    def writeFile(self, path, text):
        if re.match(r"^/[A-Za-z]:/", path):
            path = path[1:]
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
            print("[harness] wrote %d bytes -> %s" % (len(text), path))
            return True
        except OSError as exc:
            print("[harness] write FAILED %s (%s)" % (path, exc))
            return False

    @Slot(result=str)
    def pluginDir(self):
        return PLUGIN_DIR

    @Slot(str, result=str)
    def pluginUrl(self, name):
        return QUrl.fromLocalFile(os.path.join(PLUGIN_DIR, name)).toString()


def write_sandbox_token():
    """Put LETSFG_BEARER_TOKEN into a sandbox ~/.letsfg/config.json, if set."""
    cfg_dir = os.path.join(SANDBOX_HOME, ".letsfg")
    cfg_path = os.path.join(cfg_dir, "config.json")
    token = os.environ.get("LETSFG_BEARER_TOKEN", "").strip()

    if not token:
        # Leave no stale credential behind from a previous run.
        if os.path.exists(cfg_path):
            os.remove(cfg_path)
        return False

    os.makedirs(cfg_dir, exist_ok=True)
    expires_at = float(os.environ.get("LETSFG_TOKEN_EXPIRES_AT", "") or (time.time() + 80 * 86400))
    with open(cfg_path, "w", encoding="utf-8") as fh:
        json.dump({"pfs_auth": {"token": token, "expires_at": expires_at}}, fh)
    try:
        os.chmod(cfg_path, 0o600)
    except OSError:
        pass
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--screenshot", metavar="PNG", help="render, save a PNG, and exit")
    ap.add_argument("--delay", type=float, default=2.0, help="seconds before the screenshot")
    ap.add_argument("--strict", action="store_true", help="exit non-zero if QML warned")
    ap.add_argument("--keep-token", action="store_true",
                    help="leave the sandbox token file in place after exit")
    ap.add_argument("--fixture", nargs="?", const="preview/fixture-offers.json",
                    metavar="JSON",
                    help="render a canned offers payload instead of searching "
                         "(no network, no quota spent)")
    ap.add_argument("--save-token-check", action="store_true",
                    help="write a test token through the real save path")
    ap.add_argument("--persist-check", action="store_true",
                    help="report whether a previously saved token was remembered")
    ap.add_argument("--auth-check", action="store_true",
                    help="drive the in-panel sign-in (opens Stripe in a browser)")
    ap.add_argument("--no-token-check", action="store_true",
                    help="press Search with no token and report what happened")
    ap.add_argument("--open-menu", metavar="NAME",
                    help="open a filter dropdown (sort/stops/times/airlines/price/bags)")
    ap.add_argument("--route", nargs=2, metavar=("FROM", "TO"),
                    help="pre-fill the route without searching")
    ap.add_argument("--search", nargs=2, metavar=("FROM", "TO"),
                    help="simulate a user pressing Search on this route "
                         "(costs one real search against your token)")
    ap.add_argument("--search-after", type=float, default=1.5,
                    help="seconds to wait for the token to load before searching")
    args = ap.parse_args()

    qInstallMessageHandler(_handler)
    os.makedirs(SANDBOX_HOME, exist_ok=True)
    has_token = write_sandbox_token()
    print("token: %s" % ("present (sandbox)" if has_token else
                         "ABSENT - panel will show its no-token state"))

    # The native Windows style refuses control customisation, which is noise
    # here -- Omarchy draws its own controls anyway.
    QQuickStyle.setStyle("Basic")

    app = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()
    engine.addImportPath(STUBS_DIR)

    Host.preset_route = args.search or args.route
    host = Host(SANDBOX_HOME.replace(os.sep, "/"))
    engine.rootContext().setContextProperty("Host", host)

    errors = []
    engine.warnings.connect(lambda errs: errors.extend(str(e) for e in errs))

    engine.load(QUrl.fromLocalFile(os.path.join(PREVIEW_DIR, "main.qml")))
    if not engine.rootObjects():
        print("\nFAILED: the QML did not load. See the messages above.", file=sys.stderr)
        return 2

    window = engine.rootObjects()[0]

    if args.fixture:
        fixture_path = args.fixture
        if not os.path.isabs(fixture_path):
            fixture_path = os.path.join(PLUGIN_DIR, fixture_path)
        with open(fixture_path, "r", encoding="utf-8") as fh:
            fixture_text = fh.read()

        def load():
            print("rendering fixture: %s" % fixture_path)
            QMetaObject.invokeMethod(window, "loadFixture", Q_ARG(str, fixture_text))
        QTimer.singleShot(600, load)

    if args.open_menu:
        def om():
            QMetaObject.invokeMethod(window, "debugOpenMenu", Q_ARG(str, args.open_menu))
        QTimer.singleShot(1100, om)

    if args.search:
        def fire():
            print("simulating a Search click: %s -> %s" % (args.search[0], args.search[1]))
            QMetaObject.invokeMethod(window, "simulateSearch")
        QTimer.singleShot(int(args.search_after * 1000), fire)

    if args.save_token_check:
        QTimer.singleShot(2500, lambda: QMetaObject.invokeMethod(window, "debugSaveToken"))
    if args.persist_check:
        QTimer.singleShot(2500, lambda: QMetaObject.invokeMethod(window, "reportPersisted"))

    if args.auth_check:
        QTimer.singleShot(2500, lambda: QMetaObject.invokeMethod(window, "reportAuth"))
        QTimer.singleShot(7000, lambda: QMetaObject.invokeMethod(window, "reportAuthState"))

    if args.no_token_check:
        QTimer.singleShot(2500, lambda: QMetaObject.invokeMethod(window, "reportNoToken"))

    if args.fixture or args.search:
        QTimer.singleShot(int((args.delay - 0.4) * 1000),
                          lambda: QMetaObject.invokeMethod(window, "reportLinks"))

    if args.screenshot:
        out = os.path.abspath(args.screenshot)

        def grab():
            QMetaObject.invokeMethod(window, "grabTo", Q_ARG(str, out))
            # grabToImage is asynchronous: it completes on the next render.
            QTimer.singleShot(1200, finish)

        def finish():
            res = Host.grab_result
            if res and res[1]:
                print("screenshot saved -> %s" % res[0])
            else:
                print("screenshot FAILED (%r)" % (res,), file=sys.stderr)
            app.quit()

        QTimer.singleShot(int(args.delay * 1000), grab)

    rc = app.exec()

    if not args.keep_token:
        # Remove only the token INJECTED from LETSFG_BEARER_TOKEN, so one is
        # never left sitting in a preview directory.
        #
        # Not the whole sandbox: state/ is where an in-panel verification
        # stores its own token, and wiping it made the plugin look like it
        # forgets you every launch. A real install keeps that file, so the
        # preview must too.
        stale = os.path.join(SANDBOX_HOME, ".letsfg", "config.json")
        if os.path.exists(stale):
            os.remove(stale)

    warned = [m for lvl, m in MESSAGES if lvl in ("WARNING", "CRITICAL", "FATAL")]
    # A supplier CDN 404 on one hotel photo is a network condition, not a
    # defect in this code -- the card falls back to its placeholder. Strict
    # mode is for OUR mistakes, so remote image transfer failures are reported
    # but do not fail the run.
    external = [m for m in warned if "Error transferring http" in m]
    warned = [m for m in warned if m not in external]
    if external:
        print("")
        print("--- %d external image fetch failure(s), ignored by --strict ---" % len(external))
    print("\n--- QML diagnostics: %d warning(s)/error(s) ---" % len(warned))
    for m in warned:
        print("  " + m)
    if not warned:
        print("  none — the plugin's QML loaded clean")

    if args.strict and warned:
        return 1
    return rc


if __name__ == "__main__":
    sys.exit(main())
