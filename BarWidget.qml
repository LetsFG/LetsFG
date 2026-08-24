import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// The bar label for LetsFG flight search, and the host for the search panel.
//
// The label is a plane glyph on its own until a search returns, and the
// cheapest price from that search afterwards -- the one number worth a glance
// from the bar. Clicking opens the panel, which is where every actual search
// starts.
//
// This file deliberately holds no network code and no credentials. It hosts
// the panel and forwards the lifecycle the bar needs; Panel.qml owns the
// requests and Model.js owns every decision about what is safe to send and
// show.
BarWidget {
  id: root
  moduleName: "io.github.letsfg.flights"

  // Set by the panel after a search settles. Empty means "nothing searched
  // yet", which is the bare glyph.
  property string cheapestLabel: ""

  readonly property string glyph: "✈"
  readonly property string displayText: cheapestLabel.length > 0
    ? (glyph + "  " + cheapestLabel)
    : glyph

  // ---- Panel lifecycle. Shape contract for shell.summon/hide/toggle
  //      routing: Bar.findPanelWidget requires open/close/opened on the
  //      bar-widget root, and the popout coordinator prefers
  //      closeForPopoutSwitch over close.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function togglePanel() { if (panelLoader.item) panelLoader.item.toggle() }
  function closeForPopoutSwitch() { if (panelLoader.item) panelLoader.item.closeForPopoutSwitch() }

  // Horizontally the widget is a text label in a padded slot, so the open-panel
  // dot takes the label width; vertically it is a single icon-sized line.
  readonly property real openPanelIndicatorWidth: button.labelWidth
  readonly property real openPanelIndicatorHeight: Math.max(Style.space(10), Math.round(Style.bar.iconSlot * 0.55))

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  // Exposed so the panel can be summoned by keybind or script. Note there is
  // deliberately no `search` method here: a search costs real money upstream
  // and must be started by a person looking at the panel, never by a script
  // or a hotkey that could sit in a repeat loop. See README.
  IpcHandler {
    target: "io.github.letsfg.flights"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.vertical ? "" : root.displayText
    labelVisible: !root.vertical
    hasVisualContent: true
    fixedHeight: root.vertical ? Style.bar.iconSlot : -1
    horizontalMargin: 8.75
    verticalPadding: 8.75
    tooltipText: "LetsFG — flight search"

    onPressed: function (b) { root.togglePanel() }

    // Vertical bars get the glyph alone: a price string rotated into a
    // column is unreadable, and the panel is one click away.
    OpticalGlyph {
      visible: root.vertical
      anchors.fill: parent
      text: root.glyph
      fontFamily: button.fontFamily
      fontSize: button.fontSize
      color: button.foreground
    }
  }
}
