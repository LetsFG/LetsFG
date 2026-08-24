import QtQuick
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
