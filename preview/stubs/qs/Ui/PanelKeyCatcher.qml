import QtQuick

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
