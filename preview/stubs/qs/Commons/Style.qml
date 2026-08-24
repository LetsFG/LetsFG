pragma Singleton
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
