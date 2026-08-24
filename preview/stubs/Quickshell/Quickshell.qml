pragma Singleton
import QtQuick

// Real Quickshell exposes env() for process environment lookups. The harness
// redirects HOME at the Python side so the plugin reads a sandbox token file
// instead of the user's real one -- no plugin code changes needed.
QtObject {
  function env(name) { return Host.env(name) }
  // Quickshell's own per-shell state directory. The plugin writes its token
  // there, so the harness points it at a sandbox.
  function statePath(rel) { return Host.statePath(rel) }
  function dataPath(rel) { return Host.statePath(rel) }
  function cachePath(rel) { return Host.statePath(rel) }
}
