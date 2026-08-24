import QtQuick
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
