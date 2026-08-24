pragma Singleton
import QtQuick

QtObject {
  function controlSpec(state, fg, accent) { return { color: accent, width: 1 } }
  function localOrSurfaceSpec(a, b, c, d, e) { return { color: c, width: e } }
}
