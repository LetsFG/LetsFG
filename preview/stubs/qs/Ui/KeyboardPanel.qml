import QtQuick
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
