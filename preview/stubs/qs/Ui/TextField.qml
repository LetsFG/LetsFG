import QtQuick
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
