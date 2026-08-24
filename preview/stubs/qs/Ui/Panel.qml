import QtQuick
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
