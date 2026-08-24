import QtQuick
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
