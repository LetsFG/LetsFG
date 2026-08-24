import QtQuick

// Mirrors the parts of Quickshell.Io.FileView the plugin uses. Loading is
// asynchronous in the real thing and asynchronous here too (Qt.callLater), so
// the harness reproduces the ordering hazard the plugin is written against:
// text() immediately after reload() must NOT be trusted.
QtObject {
  id: root

  property string path: ""
  property bool preload: true
  property bool watchChanges: false
  property bool printErrors: true

  property string _text: ""

  // The real FileView exposes a `loaded` bool AND a loaded() signal (it is a
  // C++ type, so it can have both). Pure QML cannot, and the plugin only ever
  // uses the signal -- so the signal is what the stub provides.
  signal loaded()
  signal loadFailed(var error)
  signal fileChanged()

  property bool atomicWrites: true

  signal saved()
  signal saveFailed(var error)

  function text() { return root._text }

  function setText(value) {
    var ok = Host.writeFile(root.path, String(value))
    if (ok) { root._text = String(value); root.saved() }
    else root.saveFailed(null)
  }

  function reload() {
    root._text = ""            // unloaded first, exactly like the real one
    Qt.callLater(root._doLoad)
  }

  function _doLoad() {
    var content = Host.readFile(root.path)
    // A Python None crosses into QML as `undefined`, not `null` -- checking
    // only for null let a missing file fall through to the assignment below
    // and raise "Cannot assign [undefined] to QString".
    if (content === null || content === undefined || typeof content !== "string") {
      root._text = ""
      root.loadFailed(null)
      return
    }
    root._text = content
    root.loaded()
  }

  Component.onCompleted: if (root.preload && root.path.length > 0) Qt.callLater(root._doLoad)
}
