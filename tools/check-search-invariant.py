"""Enforce the invariant the README promises: a search may only begin from a
click or a keypress.

The Omarchy shell is one long-running process that reloads plugins when their
files change, and a search costs LetsFG real money and a slice of a very small
quota (3 per 10 minutes). The failure that actually happens in a desktop widget
is not a malicious user, it is a refresh loop nobody noticed -- so the rule is
enforced mechanically rather than left to care.

Checking the same LINE is not enough: a multi-line `onClicked:` handler puts
the call on its own line. This walks back to the nearest enclosing handler and
checks that instead.

    python tools/check-search-invariant.py Panel.qml
"""
import re
import sys

HANDLER = re.compile(r"\bon([A-Z]\w*)\s*:")
# Handlers that represent a person doing something. Anything else -- a Timer,
# Component.onCompleted, a property change -- is a bug by definition here.
# NOT "Triggered": Timer.onTriggered is exactly how an accidental refresh loop
# would start a search, so allowing it would have made this check vacuous. A
# negative control (injecting a repeating Timer that calls beginSearch) is what
# caught that -- a passing suite proves nothing about a guard until you watch
# it fail on purpose.
ALLOWED = {"Clicked", "Accepted", "Tapped", "Pressed", "Activated"}
# How far back a call may sit from its handler before we stop believing the
# association. Deep enough for a real handler body, shallow enough that an
# unrelated handler further up cannot vouch for it.
LOOKBACK = 12


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "Panel.qml"
    lines = open(path, encoding="utf-8").read().split("\n")

    offenders = []
    calls = 0
    for i, line in enumerate(lines):
        # Hotel search is billable and rate-limited exactly like flight search,
        # so it lives under the same rule.
        which = None
        for name in ("beginSearch()", "beginHotelSearch()"):
            if name in line:
                which = name
                break
        if which is None:
            continue
        stripped = line.lstrip()
        if stripped.startswith("//") or ("function " + which[:-2]) in line:
            continue
        calls += 1

        handler = None
        for j in range(i, max(-1, i - LOOKBACK), -1):
            m = HANDLER.search(lines[j])
            if m:
                handler = m.group(1)
                break
        if handler not in ALLOWED:
            offenders.append("%d: %s   (nearest handler: %s)"
                             % (i + 1, stripped[:70], handler))

    if offenders:
        print("  FAIL  a search is reachable from something that is not a click or a key:")
        for o in offenders:
            print("          " + o)
        return 1
    if calls == 0:
        print("  FAIL  no search call sites found - did the functions get renamed?")
        return 1
    print("  ok    search entry points have %d call site(s), all inside a click/key handler" % calls)
    return 0


if __name__ == "__main__":
    sys.exit(main())
