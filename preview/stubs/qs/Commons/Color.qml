pragma Singleton
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
