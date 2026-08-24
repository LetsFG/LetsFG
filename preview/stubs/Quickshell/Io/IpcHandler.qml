import QtQuick

// The bar's IPC surface. Nothing external calls into the harness, so this only
// has to exist and hold its declared functions without erroring.
QtObject {
  property string target: ""
}
