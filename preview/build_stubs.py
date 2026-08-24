"""Write the stub QML modules the preview harness needs.

The point of the harness is to run the REAL, UNMODIFIED BarWidget.qml and
Panel.qml outside Omarchy. To do that, the modules they import have to exist:
`Quickshell`, `Quickshell.Io`, `qs.Commons` and `qs.Ui`. These stubs mimic the
API surface the plugin actually touches -- property names, method names and
signal names taken from the real sources in basecamp/omarchy@quattro.

What this proves: the plugin's QML parses, its bindings resolve, its property
and signal names are spelled correctly, and its JavaScript runs. That is the
class of bug that otherwise only shows up as a dead bar on a stranger's desktop.

What it does NOT prove: that the real qs.Ui components behave like these
stand-ins. Layout and styling here are approximations. Treat this as a syntax,
wiring and logic check with a picture attached -- not as "verified on Omarchy".
"""
import io
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
STUBS = os.path.join(ROOT, "stubs")

FILES = {}

# ---------------------------------------------------------------- Quickshell
FILES["Quickshell/qmldir"] = """module Quickshell
singleton Quickshell 1.0 Quickshell.qml
"""

FILES["Quickshell/Quickshell.qml"] = """pragma Singleton
import QtQuick

// Real Quickshell exposes env() for process environment lookups. The harness
// redirects HOME at the Python side so the plugin reads a sandbox token file
// instead of the user's real one -- no plugin code changes needed.
QtObject {
  function env(name) { return Host.env(name) }
  // Quickshell's own per-shell state directory. The plugin writes its token
  // there, so the harness points it at a sandbox.
  function statePath(rel) { return Host.statePath(rel) }
  function dataPath(rel) { return Host.statePath(rel) }
  function cachePath(rel) { return Host.statePath(rel) }
}
"""

FILES["Quickshell/Io/qmldir"] = """module Quickshell.Io
FileView 1.0 FileView.qml
IpcHandler 1.0 IpcHandler.qml
"""

FILES["Quickshell/Io/FileView.qml"] = """import QtQuick

// Mirrors the parts of Quickshell.Io.FileView the plugin uses. Loading is
// asynchronous in the real thing and asynchronous here too (Qt.callLater), so
// the harness reproduces the ordering hazard the plugin is written against:
// text() immediately after reload() must NOT be trusted.
QtObject {
  id: root

  property string path: ""
  property bool preload: true
  property bool watchChanges: false
  property bool printErrors: true

  property string _text: ""

  // The real FileView exposes a `loaded` bool AND a loaded() signal (it is a
  // C++ type, so it can have both). Pure QML cannot, and the plugin only ever
  // uses the signal -- so the signal is what the stub provides.
  signal loaded()
  signal loadFailed(var error)
  signal fileChanged()

  property bool atomicWrites: true

  signal saved()
  signal saveFailed(var error)

  function text() { return root._text }

  function setText(value) {
    var ok = Host.writeFile(root.path, String(value))
    if (ok) { root._text = String(value); root.saved() }
    else root.saveFailed(null)
  }

  function reload() {
    root._text = ""            // unloaded first, exactly like the real one
    Qt.callLater(root._doLoad)
  }

  function _doLoad() {
    var content = Host.readFile(root.path)
    // A Python None crosses into QML as `undefined`, not `null` -- checking
    // only for null let a missing file fall through to the assignment below
    // and raise "Cannot assign [undefined] to QString".
    if (content === null || content === undefined || typeof content !== "string") {
      root._text = ""
      root.loadFailed(null)
      return
    }
    root._text = content
    root.loaded()
  }

  Component.onCompleted: if (root.preload && root.path.length > 0) Qt.callLater(root._doLoad)
}
"""

FILES["Quickshell/Io/IpcHandler.qml"] = """import QtQuick

// The bar's IPC surface. Nothing external calls into the harness, so this only
// has to exist and hold its declared functions without erroring.
QtObject {
  property string target: ""
}
"""

# ------------------------------------------------------------------ qs.Commons
FILES["qs/Commons/qmldir"] = """module qs.Commons
singleton Color 1.0 Color.qml
singleton Style 1.0 Style.qml
singleton Border 1.0 Border.qml
"""

FILES["qs/Commons/Color.qml"] = """pragma Singleton
import QtQuick

// Approximate Omarchy dark palette so the preview reads like the real bar.
QtObject {
  readonly property color background: "#16161e"
  readonly property color surface: "#1a1b26"
  readonly property color foreground: "#c0caf5"
  readonly property color accent: "#7aa2f7"
  readonly property color urgent: "#f7768e"
  readonly property QtObject tooltip: QtObject {
    readonly property color background: "#1f2335"
    readonly property color text: "#c0caf5"
    readonly property color border: "#3b4261"
  }
}
"""

FILES["qs/Commons/Style.qml"] = """pragma Singleton
import QtQuick

QtObject {
  readonly property real scale: 1.0

  function space(n) { return Math.round(n * scale) }
  function spaceReal(n) { return n * scale }
  function selectionFillFor(fg, accent) { return Qt.rgba(accent.r, accent.g, accent.b, 0.35) }
  function selectedStateColor(fg, accent) { return accent }

  readonly property real normalBorderWidth: 1

  readonly property QtObject font: QtObject {
    readonly property string family: "Segoe UI"
    readonly property real body: 13
    readonly property real bodySmall: 11
    readonly property real icon: 14
  }

  readonly property QtObject bar: QtObject {
    readonly property real iconSlot: 22
    readonly property real sizeHorizontal: 34
  }

  readonly property QtObject spacing: QtObject {
    readonly property real controlPaddingX: 8
    readonly property real controlPaddingY: 5
    readonly property real inputPaddingY: 5
  }
}
"""

FILES["qs/Commons/Border.qml"] = """pragma Singleton
import QtQuick

QtObject {
  function controlSpec(state, fg, accent) { return { color: accent, width: 1 } }
  function localOrSurfaceSpec(a, b, c, d, e) { return { color: c, width: e } }
}
"""

# ---------------------------------------------------------------------- qs.Ui
FILES["qs/Ui/qmldir"] = """module qs.Ui
BarWidget 1.0 BarWidget.qml
WidgetButton 1.0 WidgetButton.qml
OpticalGlyph 1.0 OpticalGlyph.qml
Panel 1.0 Panel.qml
KeyboardPanel 1.0 KeyboardPanel.qml
PanelKeyCatcher 1.0 PanelKeyCatcher.qml
PanelSeparator 1.0 PanelSeparator.qml
TextField 1.0 TextField.qml
Button 1.0 Button.qml
"""

FILES["qs/Ui/BarWidget.qml"] = """import QtQuick
import qs.Commons

// Base type for a bar widget. Property names match the real one so the
// plugin's `vertical`, `setting()` and `broadcast()` uses resolve.
Item {
  id: root
  property QtObject bar: null
  property string moduleName: ""
  property var settings: ({})

  readonly property bool vertical: bar ? bar.vertical : false
  readonly property int barSize: bar ? bar.barSize : Style.bar.sizeHorizontal

  function broadcast(method) { }

  function setting(name, fallback) {
    if (root.settings && name in root.settings) return root.settings[name]
    return fallback
  }
}
"""

FILES["qs/Ui/WidgetButton.qml"] = """import QtQuick
import qs.Commons

Item {
  id: root
  property var bar: null
  property string text: ""
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.body
  property color foreground: Color.foreground
  property color activeColor: Color.urgent
  property bool active: false
  property real horizontalMargin: 8.5
  property real verticalPadding: 6
  property real fixedWidth: -1
  property real fixedHeight: -1
  property bool labelVisible: true
  property bool hasVisualContent: text !== ""
  property string tooltipText: ""
  property bool interactive: true

  signal pressed(int button)
  signal wheelMoved(int delta)

  readonly property bool vertical: bar ? bar.vertical : false
  readonly property real labelWidth: label.visible ? label.implicitWidth : 0

  implicitWidth: Math.max(label.implicitWidth + horizontalMargin * 2, 24)
  implicitHeight: fixedHeight > 0 ? fixedHeight : (label.implicitHeight + verticalPadding * 2)

  Rectangle {
    anchors.fill: parent
    radius: 4
    color: mouse.containsMouse ? Qt.rgba(1, 1, 1, 0.10) : "transparent"
  }

  Text {
    id: label
    anchors.centerIn: parent
    visible: root.labelVisible
    text: root.text
    color: root.foreground
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
    textFormat: Text.PlainText
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
    onPressed: function (e) { root.pressed(e.button) }
  }
}
"""

FILES["qs/Ui/OpticalGlyph.qml"] = """import QtQuick
import qs.Commons

Text {
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.icon
  horizontalAlignment: Text.AlignHCenter
  verticalAlignment: Text.AlignVCenter
  font.family: fontFamily
  font.pixelSize: fontSize
  textFormat: Text.PlainText
}
"""

FILES["qs/Ui/Panel.qml"] = """import QtQuick
import qs.Commons

// Base type for a panel. The real one is a Quickshell layer-shell surface;
// here it is an Item so the content can be shown inside an ordinary window.
// The controller / opened / setting() surface matches the real one.
Item {
  id: root
  anchors.fill: parent

  property QtObject bar: null
  property string moduleName: ""
  property var settings: ({})
  property string ipcTarget: ""
  property bool manageIpc: true
  property alias controller: panelController
  property bool popoutSwitching: false
  property bool popoutSwitchClosing: false

  readonly property bool opened: panelController.open
  readonly property color barForeground: bar ? bar.barForeground : Color.foreground

  function open() { panelController.show() }
  function close() { panelController.hide() }
  function toggle() { opened ? close() : open() }
  function closeForPopoutSwitch() { close() }
  function switchPanel(direction) { return false }

  function setting(name, fallback) {
    if (root.settings && name in root.settings) return root.settings[name]
    return fallback
  }

  QtObject {
    id: panelController
    property bool open: false
    function show() { panelController.open = true }
    function hide() { panelController.open = false }
    function toggle() { panelController.open = !panelController.open }
  }
}
"""

FILES["qs/Ui/KeyboardPanel.qml"] = """import QtQuick
import qs.Commons

// The popup surface. Children are reparented into a content area, and the
// fittedContent* helpers exist because the plugin calls them.
Item {
  id: root
  default property alias contentData: content.data

  property var anchorItem: null
  property var owner: null
  property var bar: null
  property bool open: false
  property bool centerOnBar: true
  property var focusTarget: null
  property real contentWidth: 600
  property real contentHeight: 400

  function fittedContentWidth(desired) { return Math.min(desired, 900) }
  function fittedContentHeight(desired) { return Math.min(desired, 640) }

  visible: open
  anchors.fill: parent

  Rectangle {
    anchors.fill: parent
    color: Color.surface
    radius: 8
    border.width: 1
    border.color: Qt.rgba(1, 1, 1, 0.10)

    Item {
      id: content
      anchors.fill: parent
      anchors.margins: 14
    }
  }
}
"""

FILES["qs/Ui/PanelKeyCatcher.qml"] = """import QtQuick

Item {
  id: root
  property bool blocked: false

  signal moveRequested(int dx, int dy)
  signal activateRequested()
  signal closeRequested()
  signal tabRequested(int direction)
  signal textKey(string t)

  Keys.onPressed: function (event) {
    if (root.blocked) return
    if (event.key === Qt.Key_Escape) { root.closeRequested(); event.accepted = true }
  }
}
"""

FILES["qs/Ui/PanelSeparator.qml"] = """import QtQuick
import qs.Commons

Rectangle {
  property color foreground: Color.foreground
  property real strength: 0.12
  width: parent ? parent.width : implicitWidth
  implicitWidth: 100
  implicitHeight: 1
  height: 1
  color: Qt.rgba(foreground.r, foreground.g, foreground.b, strength)
}
"""

FILES["qs/Ui/TextField.qml"] = """import QtQuick
import QtQuick.Controls as QQC
import qs.Commons

// Inherits the Controls TextField so text / placeholderText / onAccepted /
// selectAll() behave as the plugin expects.
QQC.TextField {
  id: root
  property color foreground: Color.foreground
  property color accent: Color.accent
  property bool hasCursor: false

  color: foreground
  property color placeholderTint: Qt.darker(foreground, 1.8)
  placeholderTextColor: placeholderTint
  selectionColor: accent
  font.pixelSize: Style.font.body
  implicitHeight: 30
  padding: 6

  background: Rectangle {
    color: Qt.rgba(1, 1, 1, 0.05)
    radius: 4
    border.width: 1
    border.color: root.activeFocus ? root.accent : Qt.rgba(1, 1, 1, 0.14)
  }
}
"""

FILES["qs/Ui/Button.qml"] = """import QtQuick
import qs.Commons

Item {
  id: root
  property string text: ""
  property string iconText: ""
  property string tooltipText: ""
  property bool selected: false
  property bool active: false
  property bool bordered: false
  property bool focusable: false
  property color foreground: Color.foreground
  property color background: "transparent"
  property color accent: Color.accent
  property string fontFamily: Style.font.family
  property real fontSize: Style.font.body
  property real horizontalPadding: Style.spacing.controlPaddingX
  property real verticalPadding: Style.spacing.controlPaddingY

  signal clicked()
  signal rightClicked()
  signal hovered(bool isHovered)

  implicitWidth: label.implicitWidth + horizontalPadding * 2
  implicitHeight: label.implicitHeight + verticalPadding * 2

  Rectangle {
    anchors.fill: parent
    radius: 4
    color: root.selected
      ? Qt.rgba(root.accent.r, root.accent.g, root.accent.b, 0.28)
      : (mouse.containsMouse ? Qt.rgba(1, 1, 1, 0.10) : root.background)
    border.width: root.bordered ? 1 : 0
    border.color: root.selected ? root.accent : Qt.rgba(1, 1, 1, 0.16)
  }

  Text {
    id: label
    anchors.centerIn: parent
    text: root.text
    color: root.foreground
    font.family: root.fontFamily
    font.pixelSize: root.fontSize
    textFormat: Text.PlainText
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    acceptedButtons: Qt.LeftButton | Qt.RightButton
    onEntered: root.hovered(true)
    onExited: root.hovered(false)
    onClicked: function (e) { e.button === Qt.RightButton ? root.rightClicked() : root.clicked() }
  }
}
"""

written = 0
for rel, body in FILES.items():
    dest = os.path.join(STUBS, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    io.open(dest, "w", encoding="utf-8", newline="\n").write(body)
    written += 1

print("wrote %d stub files under %s" % (written, STUBS))
