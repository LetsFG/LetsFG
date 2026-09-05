import QtQuick
import Quickshell
import Quickshell.Io
import QtQuick.Effects
import qs.Commons
import qs.Ui
import "Model.js" as Model
// letsfg.co's own ranking engine, compiled from the public SDK by
// tools/build-ranking.py. The order /api/search returns is NOT the order the
// site shows, and using it made the plugin's list visibly disagree with the
// website.
import "assets/ranking.js" as Ranking

// The LetsFG search panel: a form, a Search button, and a list of offers.
//
// BarWidget.qml owns the bar label and hands this panel the button to anchor
// against. Model.js owns every decision about what is safe to send, parse and
// render; this file owns the requests and the pixels.
//
// ---------------------------------------------------------------------------
// HOW A REQUEST CAN START
//
// There are exactly two: pressing Search, and pressing Enter in a form field.
// Both land in beginSearch(). There is no Timer that searches, no search in
// Component.onCompleted, no property binding that triggers one, and no IPC
// method that starts one.
//
// This is not squeamishness. The Omarchy shell is one long-running process
// that reloads plugins when their files change, a search costs LetsFG real
// money upstream, and the failure that actually happens in a shell widget is
// not a malicious user -- it is a refresh loop nobody noticed. So the rule is
// mechanical and greppable: no call to beginSearch() from anything but a
// click or a key. See README, "Why there is no auto-refresh".
// ---------------------------------------------------------------------------
Panel {
  id: root
  moduleName: "io.github.letsfg.flights"
  ipcTarget: "io.github.letsfg.flights"
  manageIpc: false

  property var anchorItem: null

  // The bar tracks the widget mounted in its slot -- BarWidget.qml -- not this
  // nested panel, so everything the bar identifies a panel by has to be that
  // widget.
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  // ---- Credentials.
  //
  // The token lives in a closure inside this session object; there is no
  // getter. QML plugins share one engine, so a token held in a declared
  // property would be readable by anything else the user has installed.
  // `tokenStatus` is the redacted view -- state and days remaining, never the
  // value -- and it is the only thing the UI binds to.
  readonly property var session: Model.createSession()
  property var tokenStatus: ({ state: "missing", ready: false, expiresInDays: 0 })

  // ---- Sign-in.
  //
  // "" | "registering" | "awaiting" | "exchanging". `awaiting` means
  // letsfg.co/connect is open in a browser and we are waiting for the person
  // to paste back the address it sends them to. See Model.js "Sign-in" for
  // why a paste and not a loopback listener.
  property string authStage: ""
  property string authError: ""
  property string authClientId: ""
  // PKCE material for the attempt in progress. The verifier is not a
  // credential: it is useless without the single-use code it is bound to,
  // and it is cleared the moment the exchange finishes either way.
  property string authVerifier: ""
  property string authChallenge: ""
  property string authState: ""
  property string authPaste: ""

  function beginConnect() {
    if (root.authStage === "registering" || root.authStage === "exchanging") return
    root.authError = ""
    root.authStage = "registering"

    var pk = Model.newPkce()
    root.authVerifier = pk.verifier
    root.authChallenge = pk.challenge
    root.authState = pk.state
    root.authPaste = ""

    var xhr = newRequest(Model.RESPONSE_CAP_SMALL)
    xhr.onDone = function () {
      if (xhr.oversized) { root.authStage = ""; root.authError = oversizedMessage(); return }
      if (xhr.status !== 200 && xhr.status !== 201) {
        root.authStage = ""
        root.authError = Model.describeHttpError(xhr.status, xhr.responseText)
        return
      }
      var r = Model.parseRegisterResponse(xhr.responseText)
      if (!r.ok) { root.authStage = ""; root.authError = r.error; return }

      root.authClientId = r.clientId
      root.authStage = "awaiting"
      // The card is entered on letsfg.co in a real browser. A desktop plugin
      // must never collect it itself. The URL is built from the pinned
      // origin -- nothing off the network chooses the page.
      Qt.openUrlExternally(Model.connectUrl(r.clientId, pk.challenge, pk.state))
    }
    try {
      var url = Model.oauthRegisterUrl()
      xhr.open("POST", url)
      xhr.setRequestHeader("Content-Type", "application/json")
      xhr.setRequestHeader("Accept", "application/json")
      xhr.setRequestHeader("X-LetsFG-Client", "omarchy-plugin-letsfg/1.1.0")
      xhr.send(Model.buildRegisterBody())
    } catch (e) {
      root.authStage = ""
      root.authError = "Could not reach letsfg.co."
    }
  }

  // Same attempt, same PKCE pair: the browser tab was closed or never opened.
  function reopenConnect() {
    if (root.authClientId.length === 0 || root.authChallenge.length === 0) { beginConnect(); return }
    root.authError = ""
    Qt.openUrlExternally(Model.connectUrl(root.authClientId, root.authChallenge, root.authState))
  }

  function finishConnect() {
    if (root.authStage === "exchanging") return
    if (root.authClientId.length === 0 || root.authVerifier.length === 0) {
      root.authError = "Press Connect first."
      return
    }
    var r = Model.parseConnectReturn(root.authPaste, root.authState)
    if (!r.ok) { root.authError = r.error; return }
    root.authError = ""
    root.authStage = "exchanging"

    var xhr = newRequest(Model.RESPONSE_CAP_SMALL)
    xhr.onDone = function () {
      if (xhr.oversized) { root.authStage = "awaiting"; root.authError = oversizedMessage(); return }
      var t = Model.parseTokenResponse(xhr.responseText, Math.floor(Date.now() / 1000))
      if (!t.ok) {
        // Back to `awaiting`, not cleared: a mis-paste should be fixable
        // without opening the browser again. A code that was already used or
        // has timed out (90 s) needs a fresh approval, and the message says so.
        root.authStage = "awaiting"
        root.authError = xhr.status === 400
          ? "letsfg.co refused that code: it may have expired (they last 90 seconds) or been used already. Press Reopen and approve again."
          : (xhr.status === 200 ? t.error : Model.describeHttpError(xhr.status, xhr.responseText))
        return
      }
      root.tokenStatus = root.session.adoptTokens(t, root.authClientId, "own")
      root.authStage = ""
      root.authPaste = ""
      root.authVerifier = ""
      root.authChallenge = ""
      root.authState = ""
      root.authError = ""
      root.errorText = ""
      root.statusText = ""
      persistSession()
    }
    try {
      var url = Model.oauthTokenUrl()
      xhr.open("POST", url)
      xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded")
      xhr.setRequestHeader("Accept", "application/json")
      xhr.setRequestHeader("X-LetsFG-Client", "omarchy-plugin-letsfg/1.1.0")
      xhr.send(Model.buildCodeExchangeBody(r.code, root.authClientId, root.authVerifier))
    } catch (e) {
      root.authStage = "awaiting"
      root.authError = "Could not reach letsfg.co."
    }
  }

  // Write the session back to the file it came from. Adoption already
  // happened in memory, so the panel is usable even if this fails -- only
  // the "still signed in tomorrow" part depends on the file.
  //
  // A token from ~/.letsfg/config.json goes BACK to ~/.letsfg/config.json.
  // That is not optional: a renewal rotates the refresh token, and the CLI
  // would otherwise be left holding the spent one -- its next refresh would
  // fail, and a reused refresh token revokes the whole grant for both of us.
  // The file exists (we read it), so its directory exists and the atomic
  // rename works; the "never writes it" rule was about a directory the CLI
  // had not created yet.
  function persistSession() {
    var src = root.session.status().source
    try {
      if (src === "cli") {
        var existing = ""
        try { existing = tokenFile.text() } catch (e) { existing = "" }
        tokenFile.setText(root.session.serialise(existing))
      } else {
        var own = ""
        try { own = tokenStore.text() } catch (e) { own = "" }
        tokenStore.setText(root.session.serialise(own))
      }
    } catch (e) {
      root.authError = "Connected, but the token could not be saved — you may need to do this again next time."
    }
  }

  // ---- Renewal.
  //
  // Connect-flow access tokens live an hour; the refresh token beside them
  // lives 30 days and rotates on every use. Renewal happens only when it is
  // due -- when the token file is read (shell start, panel open, the CLI
  // rewriting it) or on a Search press that finds the token short -- and
  // never on a timer; the shell reloads plugins on file change, and a
  // refresh loop is the one thing a bar widget must not grow. Nothing in
  // here starts a search (tools/check-search-invariant.py).
  property bool refreshing: false
  property double refreshFailedAtMs: 0

  function refreshSession() {
    if (root.refreshing) return
    if (!root.session.canRefresh()) return
    if (Date.now() - root.refreshFailedAtMs < Model.REFRESH_RETRY_MS) return
    root.refreshing = true
    if (!root.tokenStatus.ready && root.errorText.length === 0) root.statusText = "Renewing your session…"

    var xhr = newRequest(Model.RESPONSE_CAP_SMALL)
    xhr.onDone = function () {
      root.refreshing = false
      if (xhr.oversized) { root.refreshFailedAtMs = Date.now(); return }
      var t = Model.parseTokenResponse(xhr.responseText, Math.floor(Date.now() / 1000))
      if (t.ok) {
        root.tokenStatus = root.session.adoptTokens(t, "", root.session.status().source)
        if (root.statusText === "Renewing your session…") root.statusText = ""
        persistSession()
        return
      }
      root.refreshFailedAtMs = Date.now()
      if (xhr.status === 400 || xhr.status === 401) {
        // The refresh token itself was refused: spent by another process,
        // past its 30 days, or revoked. There is nothing left to renew with,
        // so the only honest state is "connect again". If the CLI renewed a
        // moment ago, its file is watched and the new token arrives on its own.
        root.session.forget()
        root.tokenStatus = root.session.status()
        root.statusText = "Your session could not be renewed. Connect again — nothing is charged."
        return
      }
      if (!root.tokenStatus.ready)
        root.statusText = "Could not reach letsfg.co to renew your session. " + Model.describeHttpError(xhr.status, xhr.responseText)
    }
    try {
      root.session.sendRefresh(xhr, {
        "Accept": "application/json",
        "X-LetsFG-Client": "omarchy-plugin-letsfg/1.1.0"
      })
    } catch (e) {
      root.refreshing = false
      root.refreshFailedAtMs = Date.now()
    }
  }

  // ---- Search state.
  //
  // Cancellation is a sequence number, never a boolean. A boolean `cancelled`
  // flag set by one code path and read by another discards whichever response
  // happens to be in flight, including a good one. Every callback captures the
  // seq it was issued under and returns immediately unless it still matches.
  property int seqCounter: 0
  property int activeSeq: 0
  property var activeXhr: null
  property string searchId: ""
  // Raw, un-shaped offers accumulated across polls (see Model.mergeOffers).
  property var rawOffers: []
  // Anonymous, per-installation. Empty until installStore has answered, which
  // only costs the very first search its attribution.
  property string installId: ""
  property int pollCount: 0
  property var pollState: ({ lastCount: -1, stablePolls: 0 })

  property bool busy: false
  property string statusText: ""
  property string errorText: ""
  property var offers: []

  // Client-side throttle and circuit breaker. The server limits per token;
  // this limits per panel, which is the layer that can actually stop a loop
  // before it becomes traffic.
  property var gate: ({
    inFlight: false, lastSearchAtMs: 0, blockedUntilMs: 0,
    consecutiveFailures: 0, breakerOpen: false
  })
  property var rateInfo: ({ limit: 0, remaining: -1 })

  // Form defaults are READ from shell.json and never written back. This plugin
  // does not modify user configuration at all -- see README.
  readonly property string defaultOrigin: Model.normalizeIata(setting("defaultOrigin", ""))
  readonly property string defaultDestination: Model.normalizeIata(setting("defaultDestination", ""))
  readonly property string defaultCabin: Model.isValidCabin(setting("defaultCabin", "M")) ? setting("defaultCabin", "M") : "M"

  property string cabin: defaultCabin
  property int adults: 1
  property string currency: Model.isValidCurrency(setting("currency", "EUR"))
    ? String(setting("currency", "EUR")).toUpperCase() : "EUR"

  // The search terms live here, not in the text fields. The fields are just
  // editors: when idle a slot shows "Gdansk (GDN)", and only turns into an
  // input once clicked -- the way the site's collapsed search bar behaves.
  property string originCode: defaultOrigin
  property string destCode: defaultDestination
  property string departDate: ""
  property string returnDate: ""

  // City names are learned from the results (offers carry origin_name /
  // destination_name); until a search has run there is only the code to show.
  property string originCity: ""
  property string destCity: ""

  // "" | "from" | "to"
  property string editingField: ""
  property int airportsLoaded: 0

  // "flights" | "hotels" -- the header tabs actually switch the pane.
  property string tab: "flights"

  // ---- Hotels.
  //
  // Same credential as flights: /developers/api/v1/hotels/* accepts the PFS
  // Bearer token. The dates are the SAME two fields the flight search uses --
  // one calendar, read as check-in/check-out here.
  property real hotelCityId: 0
  property string hotelCityName: ""
  property string hotelQuery: ""
  property var hotelSuggestions: []
  property bool hotelBusy: false
  property string hotelError: ""
  property string hotelStatus: ""
  property var hotels: []
  property bool hotelEditing: false
  // Mirrors hasSearched for flights: the hotels tab only replaces the home
  // content once it actually has something of its own to show.
  property bool hotelHasSearched: false

  // Either tab showing its own results. Anything else means the shared home
  // content (hero, social proof, popular) stays on screen.
  readonly property bool showingResults:
    (root.tab === "flights" && root.hasSearched)
    || (root.tab === "hotels" && root.hotelHasSearched)
  property var hotelGate: ({ inFlight: false, lastSearchAtMs: 0, blockedUntilMs: 0,
                             consecutiveFailures: 0, breakerOpen: false })

  readonly property int hotelNights: Model.nightsBetween(root.departDate, root.returnDate)

  function patchHotelGate(values) {
    var next = {}
    for (var k in root.hotelGate) next[k] = root.hotelGate[k]
    for (var j in values) next[j] = values[j]
    root.hotelGate = next
  }

  // City lookup. Cheap, but still only on typing -- never on a timer.
  function lookupHotelCity() {
    if (root.hotelQuery.length < 2) { root.hotelSuggestions = []; return }
    if (!root.session.ready()) return
    var q = root.hotelQuery
    var xhr = newRequest(Model.RESPONSE_CAP_SMALL)
    xhr.onDone = function () {
      if (xhr.oversized) return
      // A stale reply for a query the user has moved on from must not
      // repopulate the list underneath them.
      if (q !== root.hotelQuery) return
      if (xhr.status !== 200) return
      try { root.hotelSuggestions = Model.parseHotelDestinations(xhr.responseText, 6) }
      catch (e) { root.hotelSuggestions = [] }
    }
    try {
      var url = Model.hotelDestinationsUrl()
      xhr.open("POST", url)
      xhr.setRequestHeader("Content-Type", "application/json")
      xhr.setRequestHeader("Accept", "application/json")
      xhr.setRequestHeader("X-LetsFG-Client", "omarchy-plugin-letsfg/1.1.0")
      root.session.applyTo(xhr, url)
      xhr.send(JSON.stringify({ text: q }))
    } catch (e) { /* no suggestions */ }
  }

  function chooseHotelCity(id, name) {
    root.hotelCityId = id
    root.hotelCityName = name
    root.hotelQuery = name
    root.hotelSuggestions = []
    root.hotelEditing = false
  }

  // The ONLY entry point that issues a hotel search. Same rule as flights:
  // reachable from a click or a keypress and nothing else.
  function beginHotelSearch() {
    root.hotelError = ""
    if (!root.session.ready()) {
      if (root.session.canRefresh()) { refreshSession(); root.hotelError = "Renewing your session — press Search again in a moment."; return }
      root.hotelError = tokenHint(root.tokenStatus.state); return
    }

    var check = Model.throttleCheck(root.hotelGate, Date.now())
    if (!check.allowed) { root.hotelError = check.reason; return }

    var built = Model.buildHotelSearchBody({
      cityId: root.hotelCityId, cityName: root.hotelCityName,
      checkIn: root.departDate, checkOut: root.returnDate, adults: root.adults
    })
    if (!built.ok) { root.hotelError = built.error; return }

    root.hotelBusy = true
    root.hotelHasSearched = true
    root.hotels = []
    root.hotelSuggestions = []
    root.hotelEditing = false
    root.calendarOpen = false
    root.hotelStatus = "Opening a session with the supplier\u2026"
    patchHotelGate({ inFlight: true, lastSearchAtMs: Date.now() })
    hotelWatchdog.restart()

    var nights = root.hotelNights
    var xhr = newRequest(Model.RESPONSE_CAP_SMALL)
    xhr.onDone = function () {
      hotelWatchdog.stop()
      root.hotelBusy = false
      if (xhr.oversized) { root.hotelStatus = ""; root.hotelError = oversizedMessage(); return }
      patchHotelGate({ inFlight: false })

      if (xhr.status !== 200) {
        if (handleAuthFailure(xhr.status, xhr.responseText)) { root.hotelStatus = ""; return }
        var noted = Model.noteFailure(root.hotelGate)
        patchHotelGate({ consecutiveFailures: noted.consecutiveFailures, breakerOpen: noted.breakerOpen })
        root.hotelStatus = ""
        root.hotelError = Model.describeHttpError(xhr.status, xhr.responseText)
        return
      }
      var parsed = Model.parseJsonBody(xhr.responseText)
      if (!parsed.ok) { root.hotelError = parsed.error; root.hotelStatus = ""; return }
      patchHotelGate({ consecutiveFailures: 0, breakerOpen: false })
      root.hotels = Model.summarizeHotels(parsed.value, nights, 20)
      root.hotelStatus = root.hotels.length > 0
        ? (root.hotels.length + " stays, free cancellation only")
        : "No free-cancellation rooms for those dates."
    }

    try {
      var url = Model.hotelSearchUrl()
      xhr.open("POST", url)
      xhr.setRequestHeader("Content-Type", "application/json")
      xhr.setRequestHeader("Accept", "application/json")
      xhr.setRequestHeader("X-LetsFG-Client", "omarchy-plugin-letsfg/1.1.0")
      root.session.applyTo(xhr, url)
      xhr.send(JSON.stringify(built.body))
    } catch (e) {
      hotelWatchdog.stop()
      root.hotelBusy = false
      patchHotelGate({ inFlight: false })
      root.hotelError = "Could not start the hotel search."
    }
  }
  property bool travelersOpen: false

  // The panel opens as the site's homepage and becomes the results page once a
  // search has produced something.
  property bool hasSearched: false

  // Sorting and narrowing, all client-side over offers already fetched.
  property string sortKey: "best"
  property string stopFilter: "any"
  property string bagFilter: "any"
  property string timeFilter: "any"
  property string airlineFilter: "any"
  property real maxPriceFilter: 0

  readonly property var visibleOffers: Model.sortOffers(
    Model.filterOffers(root.offers, {
      stops: root.stopFilter, bags: root.bagFilter, time: root.timeFilter,
      airline: root.airlineFilter, maxPrice: root.maxPriceFilter
    }), root.sortKey)

  function resetFilters() {
    root.sortKey = "best"; root.stopFilter = "any"; root.bagFilter = "any"
    root.timeFilter = "any"; root.airlineFilter = "any"; root.maxPriceFilter = 0
  }

  // ---- Appearance.
  //
  // The panel paints letsfg.co's own palette rather than inheriting the bar's
  // theme colours. That is a deliberate departure from most Omarchy plugins:
  // this is a branded surface, and a flight card reads the way it does on the
  // site because of the light ground. The values are lifted from the live
  // site's computed styles and live in Model.PALETTE so the inline components
  // below can reach them too.
  readonly property color brandOrange: Model.PALETTE.brandOrange
  readonly property color brandAmber: Model.PALETTE.brandAmber
  readonly property color surfaceBg: Model.PALETTE.surface
  readonly property color cardBg: Model.PALETTE.card
  readonly property color inkPrimary: Model.PALETTE.ink
  readonly property color inkMuted: Model.PALETTE.inkMuted
  readonly property color inkFaint: Model.PALETTE.inkFaint
  readonly property color hairline: Model.PALETTE.hairline
  readonly property string brandFont: Model.PALETTE.font
  readonly property string heroFont: "Kalam"

  // Carrier marks come from a third-party CDN (see Model.airlineLogoUrl and
  // the README). Anyone who would rather the plugin talk to letsfg.co and
  // nothing else can set "airlineLogos": false on the widget in shell.json,
  // and the cards fall back to initials.
  readonly property bool showLogos: setting("airlineLogos", true) !== false

  // The homepage's stargazer faces. Same opt-out shape as the logos: set
  // "socialProof": false and the plugin never contacts GitHub, and the row
  // simply does not appear.
  readonly property bool showAvatars: setting("socialProof", true) !== false

  // Kept for anything still theming off the bar.
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color mutedForeground: Qt.darker(contentForeground, 1.6)

  // A text field having focus must suppress the panel's single-key shortcuts,
  // or typing "WAW" into From would be read as three commands.
  readonly property bool editing: root.editingField.length > 0

  // ---- Dates -----------------------------------------------------------

  function isoDay(date) {
    return date.getFullYear() + "-"
      + (date.getMonth() + 1 < 10 ? "0" : "") + (date.getMonth() + 1) + "-"
      + (date.getDate() < 10 ? "0" : "") + date.getDate()
  }

  function todayIso() { return isoDay(new Date()) }

  // The panel is built once, at shell startup, and an Omarchy session runs for
  // weeks. A departure date computed at load is therefore a date in the past
  // by the time it is looked at -- and buildSearchBody rightly refuses it, on
  // a form the user never touched. So the dates are re-derived every time the
  // panel opens rather than bound once.
  function refreshDates() {
    var today = todayIso()
    if (root.departDate.length === 0 || !Model.isValidDate(root.departDate) || root.departDate < today)
      root.departDate = defaultDepartIso()
    // A stale return date is cleared rather than guessed at: the user asked
    // for a round trip on dates that have passed, and one-way is the honest
    // default to fall back to.
    if (root.returnDate.length > 0
        && (!Model.isValidDate(root.returnDate) || root.returnDate < root.departDate))
      root.returnDate = ""
  }

  function defaultDepartIso() {
    var d = new Date()
    d.setDate(d.getDate() + 14)
    return isoDay(d)
  }

  // ---- Lifecycle -------------------------------------------------------

  function open() {
    // Ask for a re-read, but do NOT read the result here. reload() unloads
    // first and blockLoading is false, so text() at this moment returns "" --
    // which would parse as "no token" and clear a session that was perfectly
    // good. onLoaded owns adoption; this only nudges the file to be re-read
    // when it appeared after the shell started.
    tokenFile.reload()
    tokenStore.reload()
    refreshDates()
    fetchStars()
    root.controller.show()
    Qt.callLater(function () { if (root.opened) setCenterHoverRevealSuppressed(true) })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    // A search already POSTed has already been paid for, so closing the panel
    // does NOT cancel it: the bounded poll loop runs to its end and leaves the
    // cheapest price on the bar. That loop is finite by construction (at most
    // Model.MAX_POLLS polls, then it stops), so this cannot become background
    // polling -- it only finishes work the user explicitly started.
    root.controller.hide()
  }

  function toggle() { root.opened ? root.close() : root.open() }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  // Mutating a `property var` object in place does not notify bindings, so
  // every change builds a new object and assigns it.
  function patchGate(values) {
    var next = {}
    for (var k in root.gate) next[k] = root.gate[k]
    for (var j in values) next[j] = values[j]
    root.gate = next
  }

  // ---- Token -----------------------------------------------------------

  function refreshTokenStatus() {
    var now = Math.floor(Date.now() / 1000)
    // The CLI's file wins when it holds a usable token: if someone has run
    // `letsfg auth`, that is the token they expect to be using.
    // "Usable" now includes expired-but-renewable: a token past its hour with
    // a refresh token beside it is minutes from working, not dead.
    var text = ""
    try { text = tokenFile.text() } catch (e) { text = "" }
    var parsed = Model.parseTokenConfig(text, now)
    var source = "cli"
    if (parsed.state !== "ok" && !parsed.canRefresh) {
      var own = ""
      try { own = tokenStore.text() } catch (e) { own = "" }
      var mine = Model.parseTokenConfig(own, now)
      if (mine.state === "ok" || mine.canRefresh || parsed.state === "missing") { parsed = mine; source = "own" }
    }
    root.tokenStatus = root.session.adopt(parsed, source)
    // The parsed credentials are dropped here: session holds them in a closure
    // and this local goes out of scope. Nothing else in this file sees them.
    if (!root.tokenStatus.ready && root.errorText.length === 0)
      root.statusText = tokenHint(root.tokenStatus.state)
    if (root.session.refreshDue(now)) refreshSession()
  }

  // Points at the button that is right there, not at a CLI the person may not
  // have installed -- telling someone to go and run a terminal command was the
  // whole problem with the old first run.
  // Points at the button that is right there, and leads with "free" -- the
  // old copy said "run `letsfg auth`", which is both the wrong instruction now
  // and no help at all to someone who has never seen a terminal.
  function tokenHint(state) {
    if (state === "expired") return "Your session expired. Connect again — nothing is charged."
    if (state === "malformed") return "Your saved session could not be read. Connect again."
    return "Connect a card to start searching — nothing is charged."
  }

  // ---- Search ----------------------------------------------------------

  // The site's swap arrow. Assigning to the fields breaks their initial
  // bindings to the configured defaults, which is what should happen -- the
  // user has now chosen the route by hand.
  function swapRoute() {
    var heldCode = root.originCode, heldCity = root.originCity
    root.originCode = root.destCode; root.originCity = root.destCity
    root.destCode = heldCode; root.destCity = heldCity
  }

  function initialsFor(name) { return Model.initials(name) }

  function formValues() {
    return {
      origin: root.originCode,
      destination: root.destCode,
      departDate: root.departDate,
      returnDate: root.returnDate,
      adults: root.adults,
      cabin: root.cabin,
      currency: root.currency
    }
  }

  // The ONLY entry point that issues a request. Called from the Search button
  // and from Enter in a form field. Nothing else may call it.
  function beginSearch() {
    root.errorText = ""

    if (!root.session.ready()) {
      // Expired with a refresh token in hand: renew now, and ask for the
      // press again rather than searching on the renewal's completion --
      // a search may only ever start from a click or a key.
      if (root.session.canRefresh()) {
        refreshSession()
        root.errorText = "Renewing your session — press Search again in a moment."
        return
      }
      root.errorText = tokenHint(root.tokenStatus.state)
      return
    }

    var check = Model.throttleCheck(root.gate, Date.now())
    if (!check.allowed) { root.errorText = check.reason; return }

    var built = Model.buildSearchBody(formValues(), root.todayIso())
    if (!built.ok) { root.errorText = built.error; return }

    // Supersede anything still in flight, then claim a fresh sequence.
    abortActive()
    root.seqCounter = root.seqCounter + 1
    var seq = root.seqCounter
    root.activeSeq = seq

    root.busy = true
    // Straight to the results view. Waiting for the first offer meant the
    // panel sat on the homepage for the whole search and then jumped, which
    // reads as nothing happening.
    root.hasSearched = true
    root.offers = []; root.rawOffers = []
    root.editingField = ""
    root.calendarOpen = false
    root.menuFor = ""
    // Filters describe a result set; carrying them onto a different route
    // would silently hide most of what the user just asked for.
    resetFilters()
    root.searchId = ""
    root.pollCount = 0
    root.pollState = ({ lastCount: -1, stablePolls: 0, gracePolls: 0 })
    pollTimer.interval = Model.POLL_INTERVAL_MS
    root.statusText = "Searching hundreds of airlines…"
    patchGate({ inFlight: true, lastSearchAtMs: Date.now() })
    // Back to the SEARCH budget: a previous search may have left the watchdog
    // on its longer late-merge interval.
    watchdog.interval = Model.POLL_TIMEOUT_MS
    watchdog.restart()

    postSearch(seq, built.body)
  }

  // Stop the network without touching the seq the UI is showing. Bumping the
  // counter is what invalidates every in-flight callback: they compare against
  // activeSeq and a superseded one no longer matches.
  function abortActive() {
    pollTimer.stop()
    watchdog.stop()
    // Clear the gate as well as the network. An abort that leaves inFlight set
    // wedges the panel permanently: throttleCheck refuses every later search
    // with "already running" and nothing is left to clear it.
    patchGate({ inFlight: false })
    if (root.activeXhr) {
      try { root.activeXhr.abort() } catch (e) { /* already finished */ }
      root.activeXhr = null
    }
    root.seqCounter = root.seqCounter + 1
    root.activeSeq = root.seqCounter
  }

  function finish(seq, message) {
    if (seq !== root.activeSeq) return
    watchdog.stop()
    root.busy = false
    root.activeXhr = null
    patchGate({ inFlight: false })
    root.statusText = message
  }

  // The state write, with no sequence check. Only two callers: fail() below,
  // which does the check, and the watchdog, which has already invalidated the
  // sequence and must not have its own report discarded as stale.
  // A dead credential (revoked, expired, rejected) must not be left in place:
  // every later search would fail the same way and the panel would keep
  // showing a connected pill. Drop it and put verification back on screen.
  function handleAuthFailure(status, body) {
    if (!Model.isAuthFailure(status, body)) return false
    root.hasSearched = false
    root.hotelHasSearched = false
    root.offers = []; root.rawOffers = []
    root.hotels = []
    root.authStage = ""
    root.authPaste = ""
    // The access token is dead, but a refresh token may not be: try a
    // renewal before asking the person to connect again. If the renewal is
    // refused too, refreshSession() drops the session and says so.
    if (root.session.canRefresh()) {
      root.session.expire()
      root.tokenStatus = root.session.status()
      root.authError = ""
      root.errorText = ""
      refreshSession()
      return true
    }
    root.session.forget()
    root.tokenStatus = root.session.status()
    root.authError = Model.describeHttpError(status, body)
    return true
  }

  function applyFailure(message) {
    watchdog.stop()
    var noted = Model.noteFailure(root.gate)
    patchGate({ inFlight: false, consecutiveFailures: noted.consecutiveFailures, breakerOpen: noted.breakerOpen })
    root.busy = false
    root.activeXhr = null
    root.statusText = ""
    root.errorText = Model.redact(message)
  }

  // Stop, keep what we have, say nothing alarming. Used when a wait times out
  // but the search itself already produced results.
  function finishQuietly() {
    watchdog.stop()
    pollTimer.stop()
    patchGate({ inFlight: false, consecutiveFailures: 0, breakerOpen: false })
    root.busy = false
    root.activeXhr = null
    root.errorText = ""
    root.statusText = root.offers.length + " offers, best value first"
  }

  function fail(seq, message) {
    if (seq !== root.activeSeq) return
    applyFailure(message)
  }

  function noteRateLimit(xhr) {
    var info = Model.parseRateLimit(function (name) {
      try { return xhr.getResponseHeader(name) } catch (e) { return null }
    })
    if (info.limit > 0 || info.remaining >= 0) root.rateInfo = info

    // The Bearer lane reports its cool-off in the JSON body
    // ("retry_after_seconds": 600) and does not always send a Retry-After
    // header. Taking only the header meant the panel let the user fire again
    // straight after a rate limit it had been told to sit out for ten minutes,
    // which just earns another strike.
    var bodyDelay = 0
    if (xhr.status === 429) {
      try { bodyDelay = Model.retryAfterFromBody(xhr.responseText) } catch (e) { bodyDelay = 0 }
    }
    var delay = Math.max(info.retryAfterMs, bodyDelay)
    if (delay > 0) patchGate({ blockedUntilMs: Date.now() + delay })
    return info
  }

  function postSearch(seq, body) {
    var url = Model.searchUrl()
    var xhr = newRequest(Model.RESPONSE_CAP_SEARCH)
    root.activeXhr = xhr

    xhr.onDone = function () {
      // Superseded, cancelled, or the panel was torn down. Drop it silently:
      // this is the check that makes a stale response harmless rather than a
      // result that overwrites a newer search.
      if (seq !== root.activeSeq) return

      noteRateLimit(xhr)

      if (xhr.oversized) { fail(seq, oversizedMessage()); return }

      if (xhr.status !== 200 && xhr.status !== 201) {
        if (handleAuthFailure(xhr.status, xhr.responseText)) { finish(seq, ""); return }
        fail(seq, Model.describeHttpError(xhr.status, xhr.responseText))
        return
      }
      var ack = Model.parseSearchAck(xhr.responseText)
      if (!ack.ok) { fail(seq, ack.error); return }

      root.searchId = ack.searchId
      root.statusText = "Collecting offers…"
      // Poll immediately and sleep afterwards. Sleeping first puts a hard
      // floor under the fastest possible result -- a search that finished in
      // four seconds could not be reported in under the interval.
      pollOnce()
    }

    try {
      xhr.open("POST", url)
      xhr.setRequestHeader("Content-Type", "application/json")
      xhr.setRequestHeader("Accept", "application/json")
      xhr.setRequestHeader("X-LetsFG-Client", "omarchy-plugin-letsfg/1.1.0")
      // Anonymous install id, so the dashboard can count PEOPLE and not just
      // searches. Sent only here: this is the request that creates the search
      // session the analytics pipeline keys on.
      if (root.installId.length > 0) xhr.setRequestHeader("X-LetsFG-Install", root.installId)
      // Refuses to attach credentials to anything not on the pinned origin.
      root.session.applyTo(xhr, url)
      xhr.send(JSON.stringify(body))
    } catch (e) {
      fail(seq, "Could not start the search: " + e)
    }
  }

  function pollOnce() {
    var seq = root.activeSeq
    if (root.searchId.length === 0) return

    if (root.pollCount >= Model.MAX_POLLS) {
      // Not a failure: partial offers are still worth showing, and the search
      // itself finishes server-side regardless.
      finish(seq, root.offers.length > 0
        ? ("Showing " + root.offers.length + " offers (search still finishing).")
        : "The search timed out. Try again.")
      return
    }
    root.pollCount = root.pollCount + 1

    var url
    try { url = Model.resultsUrl(root.searchId) } catch (e) { fail(seq, "Bad search id from letsfg.co"); return }

    var xhr = newRequest(Model.RESPONSE_CAP_SEARCH)
    root.activeXhr = xhr
    xhr.onDone = function () {
      if (seq !== root.activeSeq) return

      noteRateLimit(xhr)

      // BEFORE the status check below, and terminal rather than retried.
      // An aborted transfer reports status 0, which would otherwise fall into
      // "a single bad poll is not a failed search" and schedule another poll --
      // turning a refusal into an unbounded retry loop against exactly the
      // endpoint that just sent something oversized.
      if (xhr.oversized) { fail(seq, oversizedMessage()); return }

      if (xhr.status === 429) { fail(seq, Model.describeHttpError(429, xhr.responseText)); return }
      if (xhr.status !== 200) {
        // A single bad poll is not a failed search -- keep going until the
        // poll budget runs out.
        pollTimer.restart()
        return
      }

      var parsed = Model.parseJsonBody(xhr.responseText)
      if (!parsed.ok) { fail(seq, parsed.error); return }

      var result = parsed.value
      // Accumulate WHILE SEARCHING, replace on the terminal poll -- exactly what
      // letsfg.co does:
      //
      //     if (data.status === 'searching') setOffers(prev => dedup([...prev, ...data.offers]))
      //     else                             setOffers(dedup(data.offers))
      //
      // Accumulating through the terminal poll too is wrong, and showed up
      // twice: the panel counted 148 where the site counted 129, and clicking
      // its top card opened the site's results page WITHOUT that offer. The
      // server drops offers between polls (dedup by id, validation), and an
      // accumulator keeps them forever -- so the panel showed offers the final
      // result no longer contains, and their ids are not in the site's list for
      // ?offer= to resolve.
      //
      // The accumulation still matters while the search runs: it is what stops
      // a mid-search dip from shrinking the list under the user.
      root.rawOffers = Model.isTerminalStatus(result.status)
        ? (Array.isArray(result.offers) ? result.offers : [])
        : Model.mergeOffers(root.rawOffers, result.offers)
      var shaped = Model.summarizeOffers({ offers: root.prepareRaw(root.rawOffers) })
      if (shaped.length > 0) {
        root.offers = shaped
        root.hasSearched = true
        // The payload is where the pretty names come from: offers carry
        // origin_name / destination_name ("Gdansk", "Barcelona"), which is
        // what turns "GDN" into "Gdansk (GDN)" in the search bar.
        if (shaped[0].originName.length > 0) root.originCity = shaped[0].originName
        if (shaped[0].destinationName.length > 0) root.destCity = shaped[0].destinationName
        if (root.hostWidget && "cheapestLabel" in root.hostWidget)
          root.hostWidget.cheapestLabel = Model.cheapestLabel(shaped)
      }

      var decision = Model.pollDecision(result, root.pollState)
      root.pollState = decision.state

      if (decision.done) {
        patchGate({ consecutiveFailures: 0, breakerOpen: false })
        fetchTransfers()
        if (root.offers.length === 0) {
          finish(seq, "No offers found for that route and date.")
        } else {
          // Naming the order matters: these arrive ranked by the API's own
          // score (price, duration, stops, layover), not by price, so without
          // this the list looks mis-sorted.
          finish(seq, root.offers.length + " offers, best value first"
            + (decision.reason === "complete" ? "" : " (fastest sources)"))
        }
        return
      }

      // A late merge is a different phase from the search itself: the search
      // is done and the count is flat, we are waiting for one lump to land
      // (GF enrich 16-75s past completion, split-ticket probe ~25-45s). Say so
      // rather than claiming offers are still being collected, and poll on the
      // site's slower grace cadence instead of hammering every 1.2s.
      if (decision.reason === "late-merge") {
        root.statusText = shaped.length > 0
          ? (shaped.length + " offers — checking for better fares…")
          : "Checking for better fares…"
        pollTimer.interval = Model.GRACE_POLL_MS
        // The watchdog exists to catch a search that never answers. Waiting out
        // a late merge is not that: the search has ANSWERED, the offers are on
        // screen, and we are collecting one more lump. Its 90s budget was
        // written for the search alone, and the grace window can run 120s past
        // completion -- so it fired mid-wait and put "letsfg.co did not respond
        // in time" above 212 perfectly good flights. Re-arm it for the grace
        // phase instead.
        watchdog.interval = Model.GRACE_WATCHDOG_MS
        watchdog.restart()
      } else {
        root.statusText = shaped.length > 0
          ? ("Collecting offers… " + shaped.length + " so far")
          : "Collecting offers…"
        pollTimer.interval = Model.POLL_INTERVAL_MS
      }
      pollTimer.restart()
    }

    try {
      xhr.open("GET", url)
      xhr.setRequestHeader("Accept", "application/json")
      xhr.setRequestHeader("X-LetsFG-Client", "omarchy-plugin-letsfg/1.1.0")
      // Carried on the poll too, not just the POST: the results are the
      // token holder's own, and the token is what buckets rate limiting.
      root.session.applyTo(xhr, url)
      xhr.send()
    } catch (e) {
      fail(seq, "Could not read results: " + e)
    }
  }

  function resetBreaker() {
    patchGate({ consecutiveFailures: 0, breakerOpen: false, blockedUntilMs: 0 })
    root.errorText = ""
  }

  // Opening a booking link. Qt.openUrlExternally hands the URL to the desktop
  // opener as a single value -- there is no shell, no argv to quote, and so no
  // command injection surface. The URL was allowlisted by safeHttpsUrl when
  // the offer was shaped; an offer whose URL did not pass has an empty string
  // here and the row is not clickable at all. Re-checked anyway: this is the
  // last point before the string leaves the process.
  // The link for a result card. /api/search returns no booking_url at all, so
  // the plugin builds the same deep link the site uses, from the search id and
  // the offer id. A `bookingUrl` is still preferred if one ever appears.
  // Build the list exactly as letsfg.co's results page builds it.
  //
  // The page this panel mirrors is website/app/flow/FlowResults.tsx, and its
  // allCards pipeline is:
  //
  //     deduplicateOffers(rawOffers)      // airline+route+time-bucket+refund,
  //                                       // keeps the cheapest
  //       .map(rawToCard)
  //       .filter(c => c.price > 0)       // a zero-priced offer is not a card
  //       .sort((a, b) => a.price - b.price)
  //       then drop repeated ids, keeping the first (= cheapest, list is sorted)
  //
  // and only then sortCards(list, mode) for display.
  //
  // This used to call Ranking.rankOffers here instead. That was the wrong
  // function: rankOffers is the 9-dimension persona ranker behind the hero and
  // top-3 slots, NOT what orders the results list. Ordering a whole list by it
  // put a cheap 2-stop 18h20m Ryanair on top where the site had a 1-stop 14h15m
  // LOT. rankOffers is still the right thing for a hero slot; it was never the
  // right thing for this list.
  //
  // A failure here must not lose the results: fall back to the API order rather
  // than showing nothing.
  function prepareRaw(rawOffers) {
    if (!Array.isArray(rawOffers) || rawOffers.length === 0) return []
    try {
      var deduped = Ranking.deduplicateOffers(rawOffers)
      if (!Array.isArray(deduped) || deduped.length === 0) deduped = rawOffers
      return Model.dedupePricedOffers(deduped)
    } catch (e) {
      return rawOffers
    }
  }

  // "KLM, EVA Air" -- every carrier flown, joined as the site joins them
  // (AirlineLogoGroup's names span). Falls back to the legacy single name so a
  // payload without segment data still labels its card.
  function carrierNames(offer) {
    if (!offer) return ""
    var list = offer.carriers
    if (!Array.isArray(list) || list.length === 0) return offer.airline || ""
    var names = []
    for (var i = 0; i < list.length; i++)
      if (list[i] && list[i].name && list[i].name.length > 0) names.push(list[i].name)
    return names.length > 0 ? names.join(", ") : (offer.airline || "")
  }

  function linkFor(offer) {
    if (!offer) return ""
    if (offer.bookingUrl && offer.bookingUrl.length > 0) return offer.bookingUrl
    return Model.offerUrl(root.searchId, offer, {
      // What was SEARCHED, not where this particular offer lands. A city
      // search (SEL) and an offer's airport (GMP/ICN) are different, and
      // sending the offer's made the site run a new search for the wrong route.
      origin: root.originCode,
      destination: root.destCode,
      departDate: root.departDate,
      returnDate: root.returnDate,
      currency: root.currency,
      adults: root.adults
    })
  }

  function openOffer(url) {
    var safe = Model.safeHttpsUrl(url)
    if (safe.length === 0) { root.errorText = "That offer has no usable booking link."; return }
    Qt.openUrlExternally(safe)
  }

  // ---- Wiring ----------------------------------------------------------

  // Lexend is letsfg.co's typeface. Bundling it (SIL OFL 1.1, see
  // assets/OFL.txt) rather than requiring a system package means the panel
  // looks the same on a fresh Omarchy install as it does on the site.
  //
  // FontLoader registers the family with the application font database, so
  // everything that asks for Model.PALETTE.font resolves it -- including the
  // inline components below, which cannot see this object's ids.
  FontLoader {
    id: brandFontLoader
    source: Qt.resolvedUrl("assets/Lexend.ttf")
  }

  // The brush face behind "Go. We'll handle it." on the site's homepage.
  // Also SIL OFL -- see assets/OFL-Kalam.txt.
  FontLoader {
    id: heroFontLoader
    source: Qt.resolvedUrl("assets/Kalam-Bold.ttf")
  }

  // The airport table behind the picker. Read once at load; a failure just
  // means the picker offers nothing and typing a bare IATA code still works.
  FileView {
    id: airportFile
    path: Qt.resolvedUrl("assets/airports.json").toString().replace("file://", "")
    preload: true
    printErrors: false
    onLoaded: {
      var n = 0
      try { n = Model.loadAirports(airportFile.text()) } catch (e) { n = 0 }
      root.airportsLoaded = n
    }
  }

  // The curated name-collision map. Small (45 entries), and only consulted when
  // nothing flyable matched, so a missing file costs those 45 names and nothing
  // else.
  FileView {
    id: nameFallbackFile
    path: Qt.resolvedUrl("assets/name-fallbacks.json").toString().replace("file://", "")
    preload: true
    printErrors: false
    onLoaded: {
      try { Model.loadNameFallbacks(nameFallbackFile.text()) } catch (e) { /* picker still works */ }
    }
  }

  // Where an in-panel sign-in stores its token.
  //
  // NOT ~/.letsfg/config.json: FileView writes atomically by renaming into the
  // target directory, so that path fails outright when ~/.letsfg does not
  // exist yet -- which is exactly the case for someone who has never run the
  // CLI, i.e. everyone this flow is for. Creating the directory would mean
  // spawning mkdir, and this plugin does not spawn processes. Quickshell's own
  // state directory is one it already owns.
  //
  // The CLI's file is still preferred on read (see refreshTokenStatus), so a
  // token from `letsfg auth` keeps winning and the two never fight.
  // An anonymous install id, generated once and kept beside the token.
  //
  // It exists so "is anyone actually using this" is answerable: searches alone
  // cannot tell one person searching ten times from ten people. It is a random
  // string -- no account, no device fingerprint, nothing derived from the
  // machine -- and deleting this file forgets it. It rides on X-LetsFG-Install
  // and only ever labels analytics.
  FileView {
    id: installStore
    path: Quickshell.statePath("letsfg-install.json")
    preload: true
    printErrors: false
    atomicWrites: true
    onLoaded: {
      var id = ""
      try {
        var parsed = Model.parseJsonBody(installStore.text())
        if (parsed.ok && parsed.value) id = Model.isValidInstallId(parsed.value.install_id)
      } catch (e) { id = "" }
      if (id.length === 0) {
        id = Model.newInstallId()
        try { installStore.setText(JSON.stringify({ install_id: id })) } catch (e) { /* analytics only */ }
      }
      root.installId = id
    }
    // First run: no file yet, so onLoaded never fires. Mint one anyway.
    onLoadFailed: {
      root.installId = Model.newInstallId()
      try { installStore.setText(JSON.stringify({ install_id: root.installId })) } catch (e) { /* analytics only */ }
    }
  }

  FileView {
    id: tokenStore
    path: Quickshell.statePath("letsfg-auth.json")
    preload: true
    printErrors: false
    atomicWrites: true
    onLoaded: root.refreshTokenStatus()
    onSaveFailed: root.authError =
      "Connected, but the token could not be saved — you may need to do this again next time."
  }

  FileView {
    id: tokenFile
    // `letsfg auth` owns this file. The plugin reads it, and writes it in
    // exactly one case: renewing a token that came from it, because the
    // rotated refresh token has to go back or the CLI is left with a spent
    // one (see persistSession). It never creates the file.
    path: Quickshell.env("HOME") + "/.letsfg/config.json"
    preload: true
    atomicWrites: true
    // The renewal worked and is in memory; only the CLI's copy is stale. Keep
    // the panel alive from its own file and say what the CLI will need.
    onSaveFailed: {
      try {
        var own = ""
        try { own = tokenStore.text() } catch (e) { own = "" }
        tokenStore.setText(root.session.serialise(own))
      } catch (e) { /* the in-memory session still works for this shell run */ }
      root.authError = "Session renewed, but ~/.letsfg/config.json could not be updated — run `letsfg auth` again before using the CLI."
    }
    // Running `letsfg auth` in a terminal rewrites this file; watching it means
    // the panel picks the new token up without being reopened.
    watchChanges: true
    onFileChanged: tokenFile.reload()
    // A missing file is the normal state before `letsfg auth` has been run,
    // not an error worth a log line every time the panel opens.
    printErrors: false
    // The single place the session is adopted from a successful read. Nothing
    // else may call refreshTokenStatus(), or it would run against a half-loaded
    // file and clear a good token.
    onLoaded: root.refreshTokenStatus()
    onLoadFailed: {
      root.tokenStatus = root.session.adopt({ state: "missing", token: "", expiresInDays: 0 })
      root.statusText = root.tokenHint("missing")
    }
  }

  // Qt's QML XMLHttpRequest has no timeout of its own, and the poll budget only
  // counts polls that actually came back -- so a connection that hangs rather
  // than fails would leave the panel busy forever with nothing left to fire.
  // This is the only thing that bounds that case.
  // A hotel search opens a real supplier session and routinely runs the better
  // part of a minute, so it gets its own, longer deadline. Without one a hung
  // connection would leave the pane busy forever, exactly as it would for
  // flights.
  // Debounce: typing "Warsaw" should be one lookup, not six.
  Timer {
    id: hotelLookup
    interval: 260
    repeat: false
    onTriggered: root.lookupHotelCity()
  }

  Timer {
    id: hotelWatchdog
    interval: Model.HOTEL_TIMEOUT_MS
    repeat: false
    onTriggered: {
      root.hotelBusy = false
      root.patchHotelGate({ inFlight: false })
      root.hotelStatus = ""
      root.hotelError = "The hotel search timed out."
    }
  }

  Timer {
    id: watchdog
    interval: Model.POLL_TIMEOUT_MS
    repeat: false
    onTriggered: {
      // Order matters: abortActive() first, so the hung request is torn down
      // and its sequence invalidated (a late callback can no longer land),
      // then report directly rather than through fail() -- whose seq check
      // this deliberately no longer satisfies.
      root.abortActive()
      // Never turn a completed search into an error message. If offers are
      // already on screen the timeout only means we stopped waiting for MORE --
      // finish quietly with what arrived rather than shouting over 212 results.
      if (root.offers.length > 0) {
        root.finishQuietly()
        return
      }
      root.applyFailure("letsfg.co did not respond in time.")
    }
  }

  Timer {
    id: pollTimer
    interval: Model.POLL_INTERVAL_MS
    repeat: false
    // This timer only ever continues a search a person started; it is armed
    // inside a poll callback and never on a schedule of its own.
    onTriggered: root.pollOnce()
  }

  // Tear-down: stop the network before the objects the callbacks close over
  // go away.
  Component.onDestruction: root.abortActive()

  // ---- Airport picker ------------------------------------------------------

  // What is typed into a place slot, kept apart from the committed code so a
  // half-typed word never becomes the search term.
  property string placeQuery: ""
  readonly property var placeSuggestions:
    (root.editingField === "from" || root.editingField === "to")
      ? Model.searchAirports(root.placeQuery, 6) : []

  function startPlaceEdit(which) {
    root.menuFor = ""
    root.editingField = which
    // Seed with the city name so the list opens on the current choice rather
    // than empty, and select-all means the first keystroke replaces it.
    root.placeQuery = (which === "from")
      ? (root.originCity || root.originCode)
      : (root.destCity || root.destCode)
  }

  function commitPlace(code, name) {
    if (root.editingField === "from") { root.originCode = code; root.originCity = name }
    else if (root.editingField === "to") { root.destCode = code; root.destCity = name }
    root.editingField = ""
    root.placeQuery = ""
  }

  // Enter with no suggestion picked: accept a bare IATA code if that is what
  // was typed, otherwise take the top suggestion, otherwise leave it alone.
  function commitPlaceFromQuery() {
    var typed = Model.normalizeIata(root.placeQuery)
    if (typed.length === 3 && Model.airportName(typed).length > 0) {
      commitPlace(typed, Model.airportName(typed))
      return true
    }
    var top = root.placeSuggestions
    if (top.length > 0) { commitPlace(top[0].code, top[0].name); return true }
    if (typed.length === 3) { commitPlace(typed, ""); return true }
    return false
  }

  // ---- Calendar ------------------------------------------------------------

  property bool calendarOpen: false
  property int calYear: 0
  property int calMonth: 0
  // "depart" until a departure is chosen, then "return" -- the same two-tap
  // range the site's picker uses.
  property string dateStage: "depart"

  readonly property var calCells: Model.monthGrid(root.calYear, root.calMonth).cells

  function openCalendar() {
    root.menuFor = ""
    root.editingField = ""
    var seed = Model.isValidDate(root.departDate) ? root.departDate : root.todayIso()
    root.calYear = parseInt(seed.slice(0, 4), 10)
    root.calMonth = parseInt(seed.slice(5, 7), 10)
    root.dateStage = "depart"
    root.calendarOpen = true
  }

  function stepCalendar(delta) {
    var next = Model.stepMonth(root.calYear, root.calMonth, delta)
    root.calYear = next.year
    root.calMonth = next.month
  }

  function pickDate(iso) {
    if (iso.length === 0) return
    if (root.dateStage === "depart") {
      root.departDate = iso
      root.returnDate = ""
      root.dateStage = "return"
      return
    }
    // A second pick before the departure moves the departure instead of
    // creating an impossible range.
    if (iso < root.departDate) { root.departDate = iso; root.returnDate = ""; return }
    root.returnDate = iso
    root.calendarOpen = false
  }

  function dayState(iso) {
    if (iso.length === 0) return "blank"
    if (iso < root.todayIso()) return "past"
    if (iso === root.departDate) return "start"
    if (iso === root.returnDate) return "end"
    if (root.returnDate.length > 0 && iso > root.departDate && iso < root.returnDate) return "between"
    return "free"
  }

  // ---- Social proof --------------------------------------------------------
  //
  // The star count behind "Already loved by 1.8k+ travellers and engineers".
  // Fetched once per panel load, never on a timer, and a failure just hides
  // the line -- see fetchStars().
  property string starCount: ""
  property var stargazers: []

  // The live "Popular right now" ranking. Model.POPULAR is the floor -- the
  // same curated six the site falls back to -- and this replaces it once the
  // homepage has been read.
  property var popular: Model.POPULAR

  // Every auxiliary request is held here for its lifetime. A local
  // XMLHttpRequest has nothing referencing it once the function returns, and
  // QML's engine is free to collect it before the reply arrives -- which it
  // does: the transfers call was sent and its handler simply never ran. The
  // search path never hit this because it parks its request on activeXhr.
  property var auxRequests: []

  // The ONLY place an XMLHttpRequest is constructed.
  //
  // A marketplace security review found that every request path kept and
  // parsed a complete letsfg.co response with no byte bound, and that the
  // search watchdog bounded elapsed TIME but not bytes already received --
  // and did not cover the auxiliary requests at all. That was correct.
  // Model.MAX_RESPONSE_CHARS existed, but it was checked inside parseJsonBody,
  // against a finished responseText: by then the allocation it was meant to
  // prevent had already happened inside the long-lived shell process, and only
  // 2 of the 10 request paths went through it.
  //
  // Fixing ten call sites would have reproduced the reported defect -- one
  // forgotten path is the whole finding. So construction is centralised here,
  // the guard is installed before the caller sees the object, and
  // tools/validate.sh fails the build if `new XMLHttpRequest()` appears
  // anywhere else. Same mechanical rule as beginSearch()'s call sites.
  //
  // Callers set `xhr.onDone` instead of `onreadystatechange`; assigning the
  // latter would silently remove the guard.
  function newRequest(cap, deadlineMs) {
    var limit = Model.responseCap(cap)
    var xhr = new XMLHttpRequest()
    xhr.oversized = false
    xhr.truncated = false
    xhr.onDone = null
    // Every request is bounded in TIME as well as bytes, and the two are not
    // redundant. Qt hands the body to onreadystatechange in whatever size
    // chunks it has already buffered -- measured against a hostile endless
    // response, one request saw 64 MiB in a single LOADING tick -- so the byte
    // check cannot fire before Qt's first buffer. A deadline bounds the
    // transfer regardless, and unlike the search watchdog it applies to the
    // auxiliary requests too.
    xhr.deadlineAt = Date.now() + (isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : Model.REQUEST_DEADLINE_MS)

    xhr.onreadystatechange = function () {
      // HEADERS_RECEIVED -- refuse before a single body byte is buffered when
      // the server declares an honest length. Absent on chunked responses, so
      // this is an early-out and never the guard itself.
      if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
        var declared = NaN
        try { declared = parseInt(xhr.getResponseHeader("Content-Length"), 10) } catch (e) { declared = NaN }
        if (isFinite(declared) && declared > limit) {
          xhr.oversized = true
          xhr.abort()
        }
        return
      }

      // LOADING -- the load-bearing check. Bytes are still arriving; stop the
      // transfer the moment they pass the cap instead of letting the body
      // finish. Without this a chunked response walks past the header check.
      if (xhr.readyState === XMLHttpRequest.LOADING) {
        if (responseLength(xhr) > limit) {
          xhr.oversized = true
          xhr.abort()
        }
        return
      }

      if (xhr.readyState !== XMLHttpRequest.DONE) return
      releaseRequest(xhr)

      // abort() still delivers a DONE. A body that arrived complete but over
      // the cap (no LOADING tick fired) is caught here as a backstop.
      if (!xhr.oversized && responseLength(xhr) > limit) xhr.oversized = true
      // An aborted transfer leaves a partial body. Nothing may parse it: half
      // a JSON document is malformed, but half an HTML page parses fine and
      // yields quietly wrong results.
      if (xhr.oversized) xhr.truncated = true

      if (typeof xhr.onDone === "function") xhr.onDone()
    }

    return trackRequest(xhr)
  }

  // Aborts any request that has outlived its deadline. A single shared Timer
  // rather than one per request: this plugin creates no QML objects at
  // runtime, and Qt.createQmlObject is a surface it does not want.
  Timer {
    id: requestDeadlineSweep
    interval: 1000
    repeat: true
    running: root.auxRequests.length > 0
    onTriggered: {
      var now = Date.now()
      for (var i = 0; i < root.auxRequests.length; i++) {
        var r = root.auxRequests[i]
        if (!r || !isFinite(r.deadlineAt) || now < r.deadlineAt) continue
        r.oversized = true
        r.truncated = true
        try { r.abort() } catch (e) { /* already finished */ }
      }
    }
  }

  // responseText on an aborted or empty request can throw rather than return "".
  function responseLength(xhr) {
    try { return xhr.responseText ? xhr.responseText.length : 0 } catch (e) { return 0 }
  }

  // What a caller shows when the guard fired. Deliberately not a network
  // error: an oversized response is a refusal, and must never read as
  // something worth retrying.
  function oversizedMessage() {
    return "letsfg.co sent an unexpectedly large response; it was not loaded."
  }

  function trackRequest(xhr) {
    var next = root.auxRequests.slice()
    next.push(xhr)
    root.auxRequests = next
    return xhr
  }

  function releaseRequest(xhr) {
    var next = []
    for (var i = 0; i < root.auxRequests.length; i++)
      if (root.auxRequests[i] !== xhr) next.push(root.auxRequests[i])
    root.auxRequests = next
  }

  // ---- Results map ---------------------------------------------------------
  //
  // Beside the list, the way the site's wide layout puts it. Everything about
  // it is optional: no coordinates for the destination, too narrow a panel, or
  // the setting turned off, and the list simply takes the full width.
  readonly property bool showMap: setting("map", true) !== false
  // airportsLoaded is in this binding on purpose. Model.airportCoord() reads a
  // plain JS array that FileView fills in asynchronously, and a JS array is not
  // something QML can watch -- so without a property in the expression the
  // binding evaluates once, before the table exists, and the map stays null
  // forever. This is the dependency that makes it re-evaluate.
  readonly property var mapCoord: (root.airportsLoaded > 0 && root.destCode.length > 0)
    ? Model.airportCoord(root.destCode) : null
  property int mapZoom: 9
  property var transferInfo: ({ ok: false, price: "", minutes: 0, provider: "" })

  // Ground transport for the arrival airport. Not a search and not billable:
  // one call when a search settles, never on a timer, and it fails soft to no
  // pill at all.
  function fetchTransfers() {
    root.transferInfo = ({ ok: false, price: "", minutes: 0, provider: "" })
    if (!root.showMap || root.destCode.length !== 3) return
    if (!Model.isValidDate(root.departDate)) return

    var xhr = newRequest(Model.RESPONSE_CAP_SMALL)
    xhr.onDone = function () {
      if (xhr.oversized || xhr.status !== 200) return
      try { root.transferInfo = Model.parseTransfers(xhr.responseText) } catch (e) { /* no pill */ }
    }
    try {
      var url = Model.apiUrl("/api/transfers/airport")
      xhr.open("POST", url)
      xhr.setRequestHeader("Content-Type", "application/json")
      xhr.setRequestHeader("Accept", "application/json")
      // The endpoint resolves a city-centre drop-off and answers "No
      // destination given" without a city, so the name comes from the airport
      // table when the results payload has not supplied one yet. countryCode
      // is what disambiguates same-named cities.
      xhr.send(JSON.stringify({
        iata: root.destCode,
        date: root.departDate + "T12:00:00Z",
        city: root.destCity.length > 0 ? root.destCity : Model.airportName(root.destCode),
        countryCode: Model.airportCountry(root.destCode),
        passengers: root.adults,
        currency: root.currency
      }))
    } catch (e) { /* no pill */ }
  }

  // Fetched once per panel load, never on a timer. Everything here degrades to
  // nothing: no count hides the line, no avatars hides the faces, and neither
  // is ever invented.
  function fetchStars() {
    if (root.starCount.length > 0) return

    var xhr = newRequest(Model.RESPONSE_CAP_SMALL)
    xhr.onDone = function () {
      if (xhr.oversized) { fetchStarsBadge(); return }
      if (xhr.status === 200) {
        var v = Model.parseStarsJson(xhr.responseText)
        if (v.length > 0) {
          root.starCount = v
          // The JSON route carries the faces too, so no second host is needed.
          root.stargazers = Model.parseStargazers(xhr.responseText, 5)
          return
        }
      }
      // Not deployed yet (/api/stars/social): read the count
      // off the badge letsfg.co already serves, and the faces from GitHub --
      // which is where the site's own homepage loads them from.
      fetchStarsBadge()
      fetchStargazers()
    }
    try {
      xhr.open("GET", Model.apiUrl("/api/stars/social"))
      xhr.setRequestHeader("Accept", "application/json")
      xhr.send()
    } catch (e) { /* leave it empty */ }
  }

  function fetchStarsBadge() {
    var badge = newRequest(Model.RESPONSE_CAP_SMALL)
    badge.onDone = function () {
      if (badge.oversized) return
      if (badge.status === 200) root.starCount = Model.parseStarsBadge(badge.responseText)
    }
    try {
      badge.open("GET", Model.apiUrl("/api/stars/badge"))
      badge.send()
    } catch (e) { /* no count, no line */ }
  }

  function fetchStargazers() {
    var page = newRequest(Model.RESPONSE_CAP_PAGE)
    page.onDone = function () {
      // A truncated page is the dangerous case: half a JSON document is
      // malformed and rejected, but half an HTML page parses cleanly and
      // yields quietly wrong social proof.
      if (page.oversized || page.truncated) return
      if (page.status !== 200) return
      if (root.showAvatars) root.stargazers = Model.parseStargazersFromHtml(page.responseText, 5)
      // The same document carries the real popularity ranking, so one fetch
      // serves both rather than pulling the page twice.
      var pop = Model.parsePopularFromHtml(page.responseText, 8)
      if (pop.length > 0) root.popular = pop
    }
    try {
      // letsfg.co's homepage already server-renders these avatar URLs, so the
      // faces come from our own page rather than from GitHub: GitHub is a
      // third host, allows only 60 unauthenticated calls an hour per IP, and
      // returned 401 outright from a normal network in testing.
      page.open("GET", Model.apiUrl("/en"))
      page.send()
    } catch (e) { /* no faces, just the count */ }
  }

  // ---- Filter menus --------------------------------------------------------
  //
  // One shared popup driven by panel state, rather than a popup per pill.
  property string menuFor: ""
  property var menuOptions: []
  property real menuX: 0
  property real menuY: 0

  function openMenu(which, options, item) {
    if (root.menuFor === which) { root.menuFor = ""; return }
    var pt = item.mapToItem(menuLayer, 0, item.height + Style.space(6))
    root.menuOptions = options
    root.menuX = Math.max(Style.space(4), pt.x)
    root.menuY = pt.y
    root.menuFor = which
  }

  function currentMenuKey() {
    if (root.menuFor === "sort") return root.sortKey
    if (root.menuFor === "stops") return root.stopFilter
    if (root.menuFor === "times") return root.timeFilter
    if (root.menuFor === "airlines") return root.airlineFilter
    if (root.menuFor === "bags") return root.bagFilter
    if (root.menuFor === "currency") return root.currency
    if (root.menuFor === "price") return String(root.maxPriceFilter)
    return ""
  }

  function chooseMenu(key) {
    if (root.menuFor === "sort") root.sortKey = key
    else if (root.menuFor === "stops") root.stopFilter = key
    else if (root.menuFor === "times") root.timeFilter = key
    else if (root.menuFor === "airlines") root.airlineFilter = key
    else if (root.menuFor === "bags") root.bagFilter = key
    else if (root.menuFor === "price") root.maxPriceFilter = Number(key) || 0
    else if (root.menuFor === "currency") root.currency = key
    root.menuFor = ""
  }

  function labelForKey(options, key, fallback) {
    for (var i = 0; i < options.length; i++)
      if (options[i].key === key && key !== "any" && key !== "best" && key !== "0")
        return options[i].label
    return fallback
  }

  // Preview-harness entry point: drives the pickers without a pointer so a
  // screenshot can check the parts a unit test cannot reach (popup placement,
  // the month grid). Not on the bar's IPC surface -- nothing outside the panel
  // has any business driving its UI.
  function debugShow(what, arg) {
    if (what === "place") {
      root.startPlaceEdit(arg || "from")
      root.placeQuery = "gdan"
    } else if (what === "place-to") {
      root.startPlaceEdit("to")
      root.placeQuery = arg || "lond"
    } else if (what === "loading") {
      // The in-flight look, without spending a search: results view, no
      // offers yet, busy. Exactly the state the first seconds produce.
      root.hasSearched = true
      root.offers = []; root.rawOffers = []
      root.busy = true
      root.statusText = "Searching hundreds of airlines…"
    } else if (what === "loading-partial") {
      root.busy = true
    } else if (what === "hotels-tab") {
      root.tab = "hotels"
    } else if (what === "hotels-search") {
      // Sets the form up only. The harness presses the button itself, from
      // preview/main.qml -- Panel.qml deliberately contains no path to a
      // search that is not a click, and tools/check-search-invariant.py
      // fails the build if one appears. It caught this very line.
      root.tab = "hotels"
      root.chooseHotelCity(148614, "Warsaw, Poland")
      root.departDate = "2026-09-21"
      root.returnDate = "2026-09-23"
    } else if (what === "calendar") {
      root.openCalendar()
    } else {
      root.openMenuByName(what)
    }
  }

  function openMenuByName(which) {
    if (which === "sort") root.openMenu("sort", Model.SORTS, sortPill)
    else if (which === "stops") root.openMenu("stops", Model.STOP_FILTERS, stopsPill)
    else if (which === "times") root.openMenu("times", Model.TIME_FILTERS, timesPill)
    else if (which === "airlines") root.openMenu("airlines", Model.airlinesIn(root.offers), airlinesPill)
    else if (which === "price") root.openMenu("price", Model.priceSteps(root.offers), pricePill)
    else if (which === "bags") root.openMenu("bags", Model.BAG_FILTERS, bagsPill)
    else if (which === "currency") root.openMenu("currency", Model.CURRENCIES, currencyPill)
  }

  function dismissAll() {
    root.menuFor = ""
    root.editingField = ""
    root.calendarOpen = false
    root.travelersOpen = false
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(1000))
    contentHeight: panel.fittedContentHeight(root.hasSearched ? Style.space(780) : Style.space(430))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.editing
      onCloseRequested: {
        if (root.menuFor.length > 0 || root.editingField.length > 0 || root.calendarOpen) root.dismissAll()
        else root.close()
      }
      onTabRequested: function (direction) { root.switchPanel(direction) }

      Rectangle {
        anchors.fill: parent
        radius: Style.space(18)
        color: root.surfaceBg
      }

      Column {
        id: shell
        anchors.fill: parent
        anchors.margins: Style.space(16)
        spacing: Style.space(12)

        // ---- Header ---------------------------------------------------

        Item {
          width: parent.width
          height: Style.space(34)
          z: 5

          Image {
            id: brandMark
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            source: Qt.resolvedUrl("assets/letsfg-logo.png")
            height: Style.space(26)
            width: height * 2.43
            fillMode: Image.PreserveAspectFit
            smooth: true
            mipmap: true
          }

          MouseArea {
            anchors.fill: brandMark
            cursorShape: Qt.PointingHandCursor
            onClicked: { root.dismissAll(); root.hasSearched = false }
          }

          // Flights only for now. The hotel search did not work reliably and
          // shipping a tab that fails is worse than not offering it -- the code
          // behind it is left in place (root.tab still switches, the hotel
          // request path is untouched) so re-enabling it is putting this tab
          // back, not rebuilding it.
          Row {
            anchors.centerIn: parent
            spacing: Style.space(24)

            LfgTab {
              label: "Flights"
              icon: "plane"
              selected: root.tab === "flights"
              onTapped: { root.dismissAll(); root.tab = "flights" }
            }
          }

          Row {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(8)

            // Just the code in a white pill, the way the site sets USD.
            Item {
              id: currencyPill
              anchors.verticalCenter: parent.verticalCenter
              width: Style.space(64)
              height: Style.space(30)

              Rectangle {
                anchors.fill: parent
                radius: height / 2
                color: curMouse.containsMouse ? Qt.rgba(0, 0, 0, 0.04) : root.cardBg
                border.width: 1
                border.color: root.hairline
              }
              Text {
                anchors.centerIn: parent
                text: root.currency
                color: root.inkPrimary
                font.family: root.brandFont
                font.pixelSize: Style.font.bodySmall
                font.weight: Font.DemiBold
                textFormat: Text.PlainText
              }
              MouseArea {
                id: curMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.openMenu("currency", Model.CURRENCIES, currencyPill)
              }
            }

            Rectangle {
              anchors.verticalCenter: parent.verticalCenter
              width: tokenPill.implicitWidth + Style.space(20)
              height: Style.space(28)
              radius: height / 2
              color: (!root.tokenStatus.ready && pillMouse.containsMouse)
                ? Model.PALETTE.tintOrange : root.cardBg
              border.width: 1
              border.color: root.tokenStatus.ready ? root.hairline : Model.PALETTE.tintOrangeEdge

              // Not connected? The pill is the shortcut to fixing that.
              MouseArea {
                id: pillMouse
                anchors.fill: parent
                hoverEnabled: true
                enabled: !root.tokenStatus.ready
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                  root.dismissAll()
                  root.tab = "flights"
                  root.hasSearched = false
                  root.beginConnect()
                }
              }

              Text {
                id: tokenPill
                anchors.centerIn: parent
                text: root.tokenStatus.ready
                  ? (root.rateInfo.remaining >= 0
                     ? (root.rateInfo.remaining + " left") : "connected")
                  : (root.refreshing ? "renewing\u2026" : "connect \u2014 free")
                color: root.tokenStatus.ready ? root.inkMuted : root.brandOrange
                font.family: root.brandFont
                font.pixelSize: Style.font.bodySmall - 1
                textFormat: Text.PlainText
              }
            }
          }
        }

        // ---- Search bar -----------------------------------------------

        Item {
          id: searchArea
          visible: root.tab === "flights"
          width: parent.width
          height: root.tab === "flights" ? Style.space(66) : 0
          z: 20                     // above the results list, so popups show

          Rectangle {
            id: searchFrame
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(parent.width, Style.space(root.hasSearched ? 760 : 880))
            height: Style.space(root.hasSearched ? 56 : 62)
            radius: height / 2
            color: root.cardBg
            border.width: 1
            border.color: root.hairline

            Row {
              anchors.left: parent.left
              anchors.top: parent.top
              anchors.bottom: parent.bottom
              anchors.right: goButton.left
              anchors.leftMargin: Style.space(26)
              anchors.rightMargin: Style.space(10)
              spacing: 0

              // -- origin
              Item {
                id: fromSlot
                width: Style.space(186)
                height: parent.height

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  visible: root.editingField !== "from"
                  width: parent.width - Style.space(8)
                  text: root.originCode.length > 0
                    ? Model.placeLabel(root.originCity, root.originCode) : "From"
                  color: root.originCode.length > 0 ? root.inkPrimary : root.inkFaint
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body + 1
                  font.weight: Font.Bold
                  elide: Text.ElideRight
                  textFormat: Text.PlainText
                }

                TextField {
                  id: fromField
                  anchors.verticalCenter: parent.verticalCenter
                  width: parent.width - Style.space(8)
                  visible: root.editingField === "from"
                  text: root.placeQuery
                  placeholderText: "City or airport"
                  placeholderTextColor: root.inkFaint
                  foreground: root.inkPrimary
                  accent: root.brandOrange
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body + 1
                  font.weight: Font.Bold
                  background: null
                  onTextChanged: if (root.editingField === "from") root.placeQuery = text
                  onAccepted: if (root.commitPlaceFromQuery()) root.beginSearch()
                }

                MouseArea {
                  anchors.fill: parent
                  visible: root.editingField !== "from"
                  cursorShape: Qt.IBeamCursor
                  onClicked: {
                    root.startPlaceEdit("from")
                    Qt.callLater(function () { fromField.forceActiveFocus(); fromField.selectAll() })
                  }
                }
              }

              // -- swap
              Item {
                width: Style.space(40)
                height: parent.height
                Rectangle {
                  anchors.centerIn: parent
                  width: Style.space(30); height: width; radius: width / 2
                  color: swapMouse.containsMouse ? Model.PALETTE.tintOrange : Qt.rgba(0, 0, 0, 0.045)
                  LfgIcon {
                    anchors.centerIn: parent
                    icon: "arrow-left-right"
                    tone: swapMouse.containsMouse ? "orange" : "muted"
                    width: Style.space(15); height: width
                  }
                }
                MouseArea {
                  id: swapMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.swapRoute()
                }
              }

              // -- destination
              Item {
                id: toSlot
                width: Style.space(186)
                height: parent.height

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  visible: root.editingField !== "to"
                  width: parent.width - Style.space(8)
                  text: root.destCode.length > 0
                    ? Model.placeLabel(root.destCity, root.destCode) : "To"
                  color: root.destCode.length > 0 ? root.inkPrimary : root.inkFaint
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body + 1
                  font.weight: Font.Bold
                  elide: Text.ElideRight
                  textFormat: Text.PlainText
                }

                TextField {
                  id: toField
                  anchors.verticalCenter: parent.verticalCenter
                  width: parent.width - Style.space(8)
                  visible: root.editingField === "to"
                  text: root.placeQuery
                  placeholderText: "City or airport"
                  placeholderTextColor: root.inkFaint
                  foreground: root.inkPrimary
                  accent: root.brandOrange
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body + 1
                  font.weight: Font.Bold
                  background: null
                  onTextChanged: if (root.editingField === "to") root.placeQuery = text
                  onAccepted: if (root.commitPlaceFromQuery()) root.beginSearch()
                }

                MouseArea {
                  anchors.fill: parent
                  visible: root.editingField !== "to"
                  cursorShape: Qt.IBeamCursor
                  onClicked: {
                    root.startPlaceEdit("to")
                    Qt.callLater(function () { toField.forceActiveFocus(); toField.selectAll() })
                  }
                }
              }

              Rectangle {
                width: 1
                height: parent.height * 0.46
                anchors.verticalCenter: parent.verticalCenter
                color: root.hairline
              }

              // -- dates
              Item {
                id: dateSlot
                width: Style.space(168)
                height: parent.height

                Row {
                  anchors.centerIn: parent
                  spacing: Style.space(8)
                  LfgIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    icon: "calendar"
                    tone: root.calendarOpen ? "ink" : "muted"
                    width: Style.space(15); height: width
                  }
                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: {
                      var d = Model.shortDayLabel(root.departDate)
                      if (d.length === 0) return "When"
                      var r = Model.shortDayLabel(root.returnDate)
                      return r.length > 0 ? (d + " – " + r) : d
                    }
                    color: root.departDate.length > 0 ? root.inkPrimary : root.inkFaint
                    font.family: root.brandFont
                    font.pixelSize: Style.font.body
                    font.weight: Font.DemiBold
                    textFormat: Text.PlainText
                  }
                }
                MouseArea {
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.calendarOpen ? (root.calendarOpen = false) : root.openCalendar()
                }
              }

              Rectangle {
                width: 1
                height: parent.height * 0.46
                anchors.verticalCenter: parent.verticalCenter
                color: root.hairline
              }

              // -- travellers. A pill that opens a counter, not steppers
              //    wedged into the bar.
              Item {
                id: travelersSlot
                width: Style.space(112)
                height: parent.height

                Row {
                  anchors.centerIn: parent
                  spacing: Style.space(7)
                  LfgIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    icon: "users"
                    tone: root.travelersOpen ? "ink" : "muted"
                    width: Style.space(15); height: width
                  }
                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: String(root.adults)
                    color: root.inkPrimary
                    font.family: root.brandFont
                    font.pixelSize: Style.font.body
                    font.weight: Font.DemiBold
                    textFormat: Text.PlainText
                  }
                  LfgIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    icon: "chevron-down"; tone: "faint"
                    width: Style.space(12); height: width
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: {
                    var wasOpen = root.travelersOpen
                    root.dismissAll()
                    root.travelersOpen = !wasOpen
                  }
                }
              }
            }

            // -- go. Anchored to the frame rather than sitting at the end of
            //    the Row, so it lands flush in the pill's right edge instead
            //    of wherever the row happens to finish.
            Rectangle {
              id: goButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.rightMargin: Style.space(6)
              width: parent.height - Style.space(12)
              height: width
              radius: width / 2
              opacity: root.tokenStatus.ready ? 1.0 : 0.4
              gradient: Gradient {
                GradientStop { position: 0.0; color: goMouse.containsMouse ? "#ff7a45" : root.brandOrange }
                GradientStop { position: 1.0; color: goMouse.containsMouse ? "#ffa02e" : root.brandAmber }
              }

              LfgIcon {
                anchors.centerIn: parent
                visible: !root.busy
                icon: root.hasSearched ? "search" : "plane"
                tone: "white"
                width: Style.space(18); height: width
              }
              Text {
                anchors.centerIn: parent
                visible: root.busy
                text: "···"
                color: "#ffffff"
                font.family: root.brandFont
                font.pixelSize: Style.font.body + 3
                font.weight: Font.Bold
                textFormat: Text.PlainText
              }

              MouseArea {
                id: goMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                  if (root.editingField.length > 0) root.commitPlaceFromQuery()
                  root.dismissAll()
                  root.beginSearch()
                }
              }
            }
          }

          // -- airport suggestions, under whichever slot is being edited
          Rectangle {
            visible: root.placeSuggestions.length > 0
            z: 60
            x: searchFrame.x + (root.editingField === "to"
                ? (Style.space(26) + fromSlot.width + Style.space(40))
                : Style.space(20))
            y: searchFrame.y + searchFrame.height + Style.space(6)
            width: Style.space(310)
            height: root.placeSuggestions.length * Style.space(42) + Style.space(10)
            radius: Style.space(14)
            color: root.cardBg
            border.width: 1
            border.color: root.hairline

            Column {
              anchors.centerIn: parent
              width: parent.width - Style.space(10)

              Repeater {
                model: root.placeSuggestions

                Rectangle {
                  required property var modelData
                  width: parent.width
                  height: Style.space(42)
                  radius: Style.space(10)
                  color: sugMouse.containsMouse ? Model.PALETTE.tintOrange : "transparent"

                  Row {
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.left: parent.left
                    anchors.leftMargin: Style.space(12)
                    spacing: Style.space(10)

                    LfgIcon {
                      anchors.verticalCenter: parent.verticalCenter
                      icon: "map-pin"
                      tone: modelData.isCity ? "orange" : "muted"
                      width: Style.space(15); height: width
                    }

                    Column {
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: 0
                      Text {
                        text: modelData.name
                        color: root.inkPrimary
                        font.family: root.brandFont
                        font.pixelSize: Style.font.bodySmall
                        font.weight: Font.DemiBold
                        textFormat: Text.PlainText
                      }
                      Text {
                        text: modelData.isCity
                          ? (modelData.code + " · all airports")
                          : (modelData.code + (modelData.country.length > 0 ? (" · " + modelData.country) : ""))
                        color: modelData.isCity ? root.brandOrange : root.inkFaint
                        font.family: root.brandFont
                        font.pixelSize: Style.font.bodySmall - 2
                        textFormat: Text.PlainText
                      }
                    }
                  }

                  MouseArea {
                    id: sugMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.commitPlace(modelData.code, modelData.name)
                  }
                }
              }
            }
          }

          // -- travellers popover
          Rectangle {
            visible: root.travelersOpen
            z: 60
            x: Math.min(searchFrame.x + searchFrame.width - Style.space(250),
                        searchArea.width - width - Style.space(4))
            y: searchFrame.y + searchFrame.height + Style.space(6)
            width: Style.space(232)
            height: Style.space(74)
            radius: Style.space(14)
            color: root.cardBg
            border.width: 1
            border.color: root.hairline

            Row {
              anchors.fill: parent
              anchors.margins: Style.space(16)
              spacing: Style.space(10)

              Column {
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(104)
                spacing: 0
                Text {
                  text: "Adults"
                  color: root.inkPrimary
                  font.family: root.brandFont
                  font.pixelSize: Style.font.bodySmall
                  font.weight: Font.DemiBold
                  textFormat: Text.PlainText
                }
                Text {
                  text: "12 and over"
                  color: root.inkFaint
                  font.family: root.brandFont
                  font.pixelSize: Style.font.bodySmall - 2
                  textFormat: Text.PlainText
                }
              }

              Row {
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(9)
                LfgStep {
                  glyph: "minus"
                  enabled: root.adults > 1
                  onTapped: if (root.adults > 1) root.adults = root.adults - 1
                }
                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  width: Style.space(20)
                  horizontalAlignment: Text.AlignHCenter
                  text: String(root.adults)
                  color: root.inkPrimary
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body
                  font.weight: Font.DemiBold
                  textFormat: Text.PlainText
                }
                LfgStep {
                  glyph: "plus"
                  enabled: root.adults < 9
                  onTapped: if (root.adults < 9) root.adults = root.adults + 1
                }
              }
            }
          }

          // -- calendar
          Rectangle {
            visible: root.calendarOpen
            z: 60
            x: Math.min(searchFrame.x + Style.space(420), searchArea.width - width - Style.space(4))
            y: searchFrame.y + searchFrame.height + Style.space(6)
            width: Style.space(300)
            height: Style.space(316)
            radius: Style.space(16)
            color: root.cardBg
            border.width: 1
            border.color: root.hairline

            Column {
              anchors.fill: parent
              anchors.margins: Style.space(14)
              spacing: Style.space(8)

              Item {
                width: parent.width
                height: Style.space(24)

                LfgRoundBtn {
                  anchors.left: parent.left
                  anchors.verticalCenter: parent.verticalCenter
                  icon: "arrow-right"
                  flipped: true
                  onTapped: root.stepCalendar(-1)
                }
                Text {
                  anchors.centerIn: parent
                  text: Model.monthTitle(root.calYear, root.calMonth)
                  color: root.inkPrimary
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body
                  font.weight: Font.DemiBold
                  textFormat: Text.PlainText
                }
                LfgRoundBtn {
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  icon: "arrow-right"
                  onTapped: root.stepCalendar(1)
                }
              }

              Row {
                width: parent.width
                Repeater {
                  model: Model.WEEKDAY_INITIALS
                  Text {
                    required property var modelData
                    width: Style.space(272) / 7
                    horizontalAlignment: Text.AlignHCenter
                    text: modelData
                    color: root.inkFaint
                    font.family: root.brandFont
                    font.pixelSize: Style.font.bodySmall - 2
                    textFormat: Text.PlainText
                  }
                }
              }

              Grid {
                columns: 7
                Repeater {
                  model: root.calCells

                  Item {
                    required property var modelData
                    width: Style.space(272) / 7
                    height: Style.space(34)

                    readonly property string state_: root.dayState(modelData)

                    Rectangle {
                      anchors.fill: parent
                      anchors.margins: Style.space(1)
                      radius: Style.space(9)
                      visible: parent.state_ === "start" || parent.state_ === "end"
                        || parent.state_ === "between" || dayMouse.containsMouse
                      color: (parent.state_ === "start" || parent.state_ === "end")
                        ? Model.PALETTE.brandOrange
                        : (parent.state_ === "between" ? Model.PALETTE.tintOrange : Qt.rgba(0, 0, 0, 0.05))
                    }

                    Text {
                      anchors.centerIn: parent
                      text: Model.dayOf(modelData)
                      color: (parent.state_ === "start" || parent.state_ === "end") ? "#ffffff"
                        : (parent.state_ === "past" ? root.inkFaint : root.inkPrimary)
                      font.family: root.brandFont
                      font.pixelSize: Style.font.bodySmall
                      font.weight: (parent.state_ === "start" || parent.state_ === "end")
                        ? Font.Bold : Font.Normal
                      textFormat: Text.PlainText
                    }

                    MouseArea {
                      id: dayMouse
                      anchors.fill: parent
                      hoverEnabled: true
                      enabled: parent.state_ !== "blank" && parent.state_ !== "past"
                      cursorShape: Qt.PointingHandCursor
                      onClicked: root.pickDate(modelData)
                    }
                  }
                }
              }

              Row {
                width: parent.width
                spacing: Style.space(8)

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: root.dateStage === "depart" ? "Pick a departure" : "Pick a return, or:"
                  color: root.inkMuted
                  font.family: root.brandFont
                  font.pixelSize: Style.font.bodySmall - 1
                  textFormat: Text.PlainText
                }

                LfgFilter {
                  label: "One way"
                  showChevron: false
                  active: root.returnDate.length === 0
                  onTapped: { root.returnDate = ""; root.calendarOpen = false }
                }
              }
            }
          }
        }

        // ---- Hotel search bar. A SIBLING of the flight one: switching
        //      tab swaps the bar, it does not replace the page.
        Item {
          width: parent.width
          height: Style.space(66)
          visible: root.tab === "hotels"
          z: 20

          Rectangle {
            id: hotelFrame
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(parent.width, Style.space(820))
            height: Style.space(58)
            radius: height / 2
            color: root.cardBg
            border.width: 1
            border.color: root.hairline

            Row {
              anchors.left: parent.left
              anchors.top: parent.top
              anchors.bottom: parent.bottom
              anchors.right: hotelGo.left
              anchors.leftMargin: Style.space(26)
              anchors.rightMargin: Style.space(10)
              spacing: 0

              Item {
                id: hotelCitySlot
                width: Style.space(272)
                height: parent.height

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  visible: !root.hotelEditing
                  width: parent.width - Style.space(8)
                  text: root.hotelCityName.length > 0 ? root.hotelCityName : "Where to?"
                  color: root.hotelCityName.length > 0 ? root.inkPrimary : root.inkFaint
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body + 1
                  font.weight: Font.Bold
                  elide: Text.ElideRight
                  textFormat: Text.PlainText
                }

                TextField {
                  id: hotelCityField
                  anchors.verticalCenter: parent.verticalCenter
                  width: parent.width - Style.space(8)
                  visible: root.hotelEditing
                  text: root.hotelQuery
                  placeholderText: "City or place"
                  placeholderTextColor: root.inkFaint
                  foreground: root.inkPrimary
                  accent: root.brandOrange
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body + 1
                  font.weight: Font.Bold
                  background: null
                  onTextChanged: if (root.hotelEditing) {
                    root.hotelQuery = text
                    hotelLookup.restart()
                  }
                  onAccepted: {
                    if (root.hotelSuggestions.length > 0)
                      root.chooseHotelCity(root.hotelSuggestions[0].id, root.hotelSuggestions[0].name)
                    root.beginHotelSearch()
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  visible: !root.hotelEditing
                  cursorShape: Qt.IBeamCursor
                  onClicked: {
                    root.dismissAll()
                    root.hotelEditing = true
                    root.hotelQuery = root.hotelCityName
                    Qt.callLater(function () { hotelCityField.forceActiveFocus(); hotelCityField.selectAll() })
                  }
                }
              }

              Rectangle {
                width: 1
                height: parent.height * 0.46
                anchors.verticalCenter: parent.verticalCenter
                color: root.hairline
              }

              // The same calendar as flights, read as a stay.
              Item {
                width: Style.space(210)
                height: parent.height
                Row {
                  anchors.centerIn: parent
                  spacing: Style.space(8)
                  LfgIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    icon: "calendar"
                    tone: root.calendarOpen ? "ink" : "muted"
                    width: Style.space(15); height: width
                  }
                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: {
                      var a = Model.shortDayLabel(root.departDate)
                      var b = Model.shortDayLabel(root.returnDate)
                      if (a.length === 0) return "When"
                      if (b.length === 0) return a + " \u2013 add a night"
                      return a + " \u2013 " + b + "  \u00b7  " + root.hotelNights
                        + (root.hotelNights === 1 ? " night" : " nights")
                    }
                    color: root.returnDate.length > 0 ? root.inkPrimary : root.inkFaint
                    font.family: root.brandFont
                    font.pixelSize: Style.font.bodySmall
                    font.weight: Font.DemiBold
                    textFormat: Text.PlainText
                  }
                }
                MouseArea {
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: {
                    root.hotelEditing = false
                    root.calendarOpen ? (root.calendarOpen = false) : root.openCalendar()
                  }
                }
              }

              Rectangle {
                width: 1
                height: parent.height * 0.46
                anchors.verticalCenter: parent.verticalCenter
                color: root.hairline
              }

              Item {
                width: Style.space(118)
                height: parent.height
                Row {
                  anchors.centerIn: parent
                  spacing: Style.space(7)
                  LfgIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    icon: "users"; tone: "muted"
                    width: Style.space(15); height: width
                  }
                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: String(root.adults)
                    color: root.inkPrimary
                    font.family: root.brandFont
                    font.pixelSize: Style.font.body
                    font.weight: Font.DemiBold
                    textFormat: Text.PlainText
                  }
                  LfgIcon {
                    anchors.verticalCenter: parent.verticalCenter
                    icon: "chevron-down"; tone: "faint"
                    width: Style.space(12); height: width
                  }
                }
                MouseArea {
                  anchors.fill: parent
                  cursorShape: Qt.PointingHandCursor
                  onClicked: {
                    var wasOpen = root.travelersOpen
                    root.dismissAll()
                    root.travelersOpen = !wasOpen
                  }
                }
              }
            }

            Rectangle {
              id: hotelGo
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.rightMargin: Style.space(6)
              width: parent.height - Style.space(12)
              height: width
              radius: width / 2
              opacity: root.tokenStatus.ready ? 1.0 : 0.4
              gradient: Gradient {
                GradientStop { position: 0.0; color: hgMouse.containsMouse ? "#ff7a45" : root.brandOrange }
                GradientStop { position: 1.0; color: hgMouse.containsMouse ? "#ffa02e" : root.brandAmber }
              }
              LfgIcon {
                anchors.centerIn: parent
                visible: !root.hotelBusy
                icon: "search"; tone: "white"
                width: Style.space(18); height: width
              }
              Text {
                anchors.centerIn: parent
                visible: root.hotelBusy
                text: "\u00b7\u00b7\u00b7"
                color: "#ffffff"
                font.family: root.brandFont
                font.pixelSize: Style.font.body + 3
                font.weight: Font.Bold
                textFormat: Text.PlainText
              }
              MouseArea {
                id: hgMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.beginHotelSearch()
              }
            }
          }

          // -- city suggestions
          Rectangle {
            visible: root.hotelSuggestions.length > 0 && root.hotelEditing
            z: 60
            x: hotelFrame.x + Style.space(20)
            y: hotelFrame.y + hotelFrame.height + Style.space(6)
            width: Style.space(360)
            height: root.hotelSuggestions.length * Style.space(40) + Style.space(10)
            radius: Style.space(14)
            color: root.cardBg
            border.width: 1
            border.color: root.hairline

            Column {
              anchors.centerIn: parent
              width: parent.width - Style.space(10)

              Repeater {
                model: root.hotelSuggestions

                Rectangle {
                  required property var modelData
                  width: parent.width
                  height: Style.space(40)
                  radius: Style.space(10)
                  color: hcMouse.containsMouse ? Model.PALETTE.tintOrange : "transparent"

                  Row {
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.left: parent.left
                    anchors.leftMargin: Style.space(12)
                    spacing: Style.space(10)
                    LfgIcon {
                      anchors.verticalCenter: parent.verticalCenter
                      icon: "map-pin"; tone: "muted"
                      width: Style.space(15); height: width
                    }
                    Text {
                      anchors.verticalCenter: parent.verticalCenter
                      width: Style.space(300)
                      text: modelData.name
                      color: root.inkPrimary
                      font.family: root.brandFont
                      font.pixelSize: Style.font.bodySmall
                      elide: Text.ElideRight
                      textFormat: Text.PlainText
                    }
                  }

                  MouseArea {
                    id: hcMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.chooseHotelCity(modelData.id, modelData.name)
                  }
                }
              }
            }
          }
        }

        // ---- Home ------------------------------------------------------

        Column {
          id: homeColumn
          width: parent.width
          // Shared by both tabs: switching to Hotels changes the search bar,
          // not the page.
          visible: !root.showingResults
          spacing: Style.space(12)
          topPadding: Style.space(14)

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Go. We'll handle it."
            color: root.brandOrange
            font.family: root.heroFont
            font.pixelSize: Style.space(46)
            textFormat: Text.PlainText
          }

          // The site's social proof: the stacked faces, then the count.
          // Shown only when the count actually arrived -- an invented number
          // would be worse than no line at all.
          // Wrapped in an Item: a Row cannot hold a child with fill anchors,
          // so the click target sits beside the Row rather than inside it.
          Item {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: root.starCount.length > 0
            width: proofRow.implicitWidth
            height: proofRow.implicitHeight

            MouseArea {
              id: proofHover
              anchors.fill: parent
              anchors.margins: -Style.space(5)
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onClicked: root.openOffer("https://letsfg.co/en/loved-by")
            }

          Row {
            id: proofRow
            spacing: Style.space(7)

            // Overlapping avatars, the way the homepage stacks them.
            Item {
              anchors.verticalCenter: parent.verticalCenter
              visible: root.stargazers.length > 0
              width: root.stargazers.length > 0
                ? (Style.space(26) + (root.stargazers.length - 1) * Style.space(17)) : 0
              height: Style.space(28)

              Repeater {
                model: root.stargazers

                Rectangle {
                  required property var modelData
                  required property int index
                  x: index * Style.space(17)
                  anchors.verticalCenter: parent.verticalCenter
                  width: Style.space(26); height: width; radius: width / 2
                  color: modelData.tint
                  border.width: 2
                  border.color: root.surfaceBg
                  // Latest stargazer on top, so the stack reads left-to-right.
                  z: root.stargazers.length - index

                  // Circular crop. Item.clip is RECTANGULAR -- it ignores
                  // radius entirely, which is why these first rendered as
                  // squares -- so the avatar is masked with a circle instead.
                  // MultiEffect ships in qtdeclarative core (Qt 6.5+), unlike
                  // QtSvg or Qt5Compat.GraphicalEffects, so this adds no
                  // optional dependency.
                  Image {
                    id: faceImage
                    anchors.fill: parent
                    anchors.margins: 2
                    source: modelData.avatar
                    asynchronous: true
                    cache: true
                    fillMode: Image.PreserveAspectCrop
                    sourceSize.width: 64
                    sourceSize.height: 64
                    visible: false
                  }

                  Rectangle {
                    id: faceMask
                    anchors.fill: faceImage
                    radius: width / 2
                    color: "black"
                    visible: false
                    layer.enabled: true
                  }

                  MultiEffect {
                    anchors.fill: faceImage
                    source: faceImage
                    maskEnabled: true
                    maskSource: faceMask
                    visible: faceImage.status === Image.Ready
                  }

                  // No avatar, or it failed: initials on the deterministic
                  // tint, matching the site's own fallback.
                  Text {
                    anchors.centerIn: parent
                    visible: faceImage.status !== Image.Ready
                    text: Model.avatarInitials(modelData.login)
                    color: "#ffffff"
                    font.family: root.brandFont
                    font.pixelSize: Style.font.bodySmall - 2
                    font.weight: Font.Bold
                    textFormat: Text.PlainText
                  }
                }
              }
            }

            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: "Already loved by"
              color: root.inkMuted
              font.family: root.brandFont
              font.pixelSize: Style.font.bodySmall
              textFormat: Text.PlainText
            }
            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: root.starCount + "+"
              color: root.brandOrange
              font.family: root.brandFont
              font.pixelSize: Style.font.bodySmall
              font.weight: Font.Bold
              textFormat: Text.PlainText
            }
            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: "travelers and engineers"
              color: proofHover.containsMouse ? root.brandOrange : root.inkMuted
              font.family: root.brandFont
              font.pixelSize: Style.font.bodySmall
              textFormat: Text.PlainText
            }
          }
          }

          // Sign-in, in the panel. No CLI and no terminal: the card is entered
          // on letsfg.co/connect in a real browser -- the only correct place
          // for card details -- and the code comes back here by paste (see
          // Model.js "Sign-in" for why a paste and not a loopback listener).
          Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: !root.tokenStatus.ready
            width: Math.min(parent.width, Style.space(560))
            height: authCol.implicitHeight + Style.space(30)
            radius: Style.space(18)
            color: root.cardBg
            border.width: 1
            border.color: Model.PALETTE.tintOrangeEdge

            Column {
              id: authCol
              anchors.centerIn: parent
              width: parent.width - Style.space(40)
              spacing: Style.space(11)

              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.refreshing
                  ? "Renewing your session"
                  : (root.tokenStatus.state === "expired" ? "Connect again" : "Connect a card")
                color: root.inkPrimary
                font.family: root.brandFont
                font.pixelSize: Style.font.body + 3
                font.weight: Font.DemiBold
                textFormat: Text.PlainText
              }

              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: root.refreshing
                  ? "One moment."
                  : (root.authStage === "awaiting" || root.authStage === "exchanging")
                    ? "Approve in your browser. It will then land on a page that cannot load — that is expected. Copy that page's address and paste it below."
                    : "Nothing is charged now. You approve every booking."
                color: root.inkMuted
                font.family: root.brandFont
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.WordWrap
                textFormat: Text.PlainText
              }

              // Step one.
              Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                visible: !root.refreshing && root.authStage !== "awaiting" && root.authStage !== "exchanging"
                width: Style.space(238)
                height: Style.space(42)
                radius: height / 2
                gradient: Gradient {
                  GradientStop { position: 0.0; color: authMouse.containsMouse ? "#ff7a45" : root.brandOrange }
                  GradientStop { position: 1.0; color: authMouse.containsMouse ? "#ffa02e" : root.brandAmber }
                }
                Row {
                  anchors.centerIn: parent
                  spacing: Style.space(8)
                  LfgSpinner {
                    anchors.verticalCenter: parent.verticalCenter
                    visible: root.authStage === "registering"
                    running: root.authStage === "registering"
                  }
                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: root.authStage === "registering" ? "Opening letsfg.co…" : "Connect at letsfg.co"
                    color: "#ffffff"
                    font.family: root.brandFont
                    font.pixelSize: Style.font.bodySmall
                    font.weight: Font.Bold
                    textFormat: Text.PlainText
                  }
                }
                MouseArea {
                  id: authMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.beginConnect()
                }
              }

              // Step two: the address the browser landed on.
              Rectangle {
                anchors.horizontalCenter: parent.horizontalCenter
                visible: root.authStage === "awaiting" || root.authStage === "exchanging"
                width: parent.width
                height: Style.space(42)
                radius: Style.space(12)
                color: root.cardBg
                border.width: 1
                border.color: pasteField.activeFocus ? root.brandOrange : root.hairline

                TextField {
                  id: pasteField
                  anchors.fill: parent
                  anchors.leftMargin: Style.space(14)
                  anchors.rightMargin: Style.space(14)
                  text: root.authPaste
                  placeholderText: "http://127.0.0.1:17531/letsfg-omarchy?code=…"
                  placeholderTextColor: root.inkFaint
                  foreground: root.inkPrimary
                  accent: root.brandOrange
                  font.family: root.brandFont
                  font.pixelSize: Style.font.bodySmall
                  background: null
                  enabled: root.authStage === "awaiting"
                  onTextChanged: root.authPaste = text
                  onAccepted: root.finishConnect()
                }
              }

              Row {
                anchors.horizontalCenter: parent.horizontalCenter
                visible: root.authStage === "awaiting" || root.authStage === "exchanging"
                spacing: Style.space(9)

                Rectangle {
                  width: Style.space(200)
                  height: Style.space(42)
                  radius: height / 2
                  gradient: Gradient {
                    GradientStop { position: 0.0; color: doneMouse.containsMouse ? "#ff7a45" : root.brandOrange }
                    GradientStop { position: 1.0; color: doneMouse.containsMouse ? "#ffa02e" : root.brandAmber }
                  }
                  Row {
                    anchors.centerIn: parent
                    spacing: Style.space(8)
                    LfgSpinner {
                      anchors.verticalCenter: parent.verticalCenter
                      visible: root.authStage === "exchanging"
                      running: root.authStage === "exchanging"
                    }
                    Text {
                      anchors.verticalCenter: parent.verticalCenter
                      text: root.authStage === "exchanging" ? "Connecting…" : "Finish"
                      color: "#ffffff"
                      font.family: root.brandFont
                      font.pixelSize: Style.font.bodySmall
                      font.weight: Font.Bold
                      textFormat: Text.PlainText
                    }
                  }
                  MouseArea {
                    id: doneMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.finishConnect()
                  }
                }

                Rectangle {
                  width: Style.space(140)
                  height: Style.space(42)
                  radius: height / 2
                  color: reopenMouse.containsMouse ? Qt.rgba(0, 0, 0, 0.04) : root.cardBg
                  border.width: 1
                  border.color: root.hairline

                  Text {
                    anchors.centerIn: parent
                    text: "Reopen letsfg.co"
                    color: root.inkMuted
                    font.family: root.brandFont
                    font.pixelSize: Style.font.bodySmall
                    font.weight: Font.DemiBold
                    textFormat: Text.PlainText
                  }

                  MouseArea {
                    id: reopenMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.reopenConnect()
                  }
                }
              }

              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                visible: root.authError.length > 0 || root.errorText.length > 0
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: root.authError.length > 0 ? root.authError : root.errorText
                color: root.brandOrange
                font.family: root.brandFont
                font.pixelSize: Style.font.bodySmall - 1
                wrapMode: Text.WordWrap
                textFormat: Text.PlainText
              }

            }
          }
          // Once connected, a search error has nowhere else to go.
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: root.tokenStatus.ready && root.errorText.length > 0
            width: Math.min(parent.width, Style.space(600))
            horizontalAlignment: Text.AlignHCenter
            text: root.errorText
            color: root.brandOrange
            font.family: root.brandFont
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
            textFormat: Text.PlainText
          }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: root.busy
            text: root.statusText
            color: root.inkMuted
            font.family: root.brandFont
            font.pixelSize: Style.font.bodySmall
            textFormat: Text.PlainText
          }

          // ---- Popular right now
          //
          // The site's curated six, with its own photos, bundled rather than
          // fetched. Clicking one is a click, so it may start a search.
          Item { width: 1; height: Style.space(6) }

          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Popular right now"
            color: root.inkPrimary
            font.family: root.brandFont
            font.pixelSize: Style.font.body + 3
            font.weight: Font.DemiBold
            textFormat: Text.PlainText
          }

          Flickable {
            id: popularScroll
            width: parent.width
            height: Style.space(108)
            // Never narrower than the viewport, so the row below can centre
            // itself inside the content area. Setting contentWidth to the raw
            // row width and nudging contentX only worked before layout and
            // left the cards jammed against the left edge.
            contentWidth: Math.max(width, popularRow.width)
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: popularRow.width > width

          Row {
            id: popularRow
            x: Math.max(0, (popularScroll.contentWidth - width) / 2)
            spacing: Style.space(12)

            Repeater {
              model: root.popular

              Item {
                id: destCard
                required property var modelData
                width: Style.space(148)
                height: Style.space(104)

                // The photo, the scrim and the labels are drawn into one
                // layer, then masked to a rounded rectangle. Item.clip is
                // RECTANGULAR -- it ignores radius -- which is why these had
                // square corners under a rounded hover border.
                Item {
                  id: destContent
                  anchors.fill: parent
                  visible: false
                  layer.enabled: true

                  Rectangle {
                    anchors.fill: parent
                    color: "#dfe5ee"
                  }

                  Image {
                    id: destImage
                    anchors.fill: parent
                    // The site resolves a photo per destination; the bundled
                    // curated six stand in when it did not give us one.
                    source: destCard.modelData.image && destCard.modelData.image.length > 0
                      ? destCard.modelData.image
                      : Qt.resolvedUrl("assets/destinations/" + destCard.modelData.code + ".jpg")
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    cache: true
                    sourceSize.width: 400
                    sourceSize.height: 300
                    smooth: true
                  }

                  // A scrim so the label stays readable over any photo.
                  Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: parent.height * 0.58
                    gradient: Gradient {
                      GradientStop { position: 0.0; color: "#00000000" }
                      GradientStop { position: 1.0; color: "#b3000000" }
                    }
                  }

                  Column {
                    anchors.left: parent.left
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: Style.space(11)
                    anchors.bottomMargin: Style.space(9)
                    spacing: 0

                    Text {
                      text: destCard.modelData.city
                      color: "#ffffff"
                      font.family: root.brandFont
                      font.pixelSize: Style.font.body
                      font.weight: Font.Bold
                      textFormat: Text.PlainText
                    }
                    Text {
                      text: destCard.modelData.code
                      color: "#e6e6e6"
                      font.family: root.brandFont
                      font.pixelSize: Style.font.bodySmall - 1
                      textFormat: Text.PlainText
                    }
                  }
                }

                Rectangle {
                  id: destMask
                  anchors.fill: parent
                  radius: Style.space(14)
                  color: "black"
                  visible: false
                  layer.enabled: true
                }

                MultiEffect {
                  anchors.fill: parent
                  source: destContent
                  maskEnabled: true
                  maskSource: destMask
                }

                Rectangle {
                  anchors.fill: parent
                  radius: Style.space(14)
                  color: "transparent"
                  border.width: destMouse.containsMouse ? 2 : 0
                  border.color: Model.PALETTE.brandOrange
                }

                MouseArea {
                  id: destMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: {
                    root.dismissAll()
                    root.destCode = destCard.modelData.code
                    root.destCity = destCard.modelData.city
                    root.beginSearch()
                  }
                }
              }
            }
          }
          }
        }

        // ---- Results ---------------------------------------------------

        // ---- Hotels ----------------------------------------------------
        //
        // Same Bearer token as flights -- /developers/api/v1/hotels/* accepts
        // it, exactly as sdk/mcp sends it. Only free-cancellation, pay-later
        // rates come back, which is why the list is shorter than a metasearch.
        Item {
          width: parent.width
          height: shell.height - y
          // Results only. The search bar moved up beside the flights one, and
          // the hero / social proof / popular row below are shared by both
          // tabs, so switching to Hotels no longer blanks the homepage.
          visible: root.tab === "hotels" && root.hotelHasSearched

          Column {
            anchors.fill: parent
            spacing: Style.space(12)


            Text {
              visible: root.hotelError.length > 0
              width: parent.width
              text: root.hotelError
              color: root.brandOrange
              font.family: root.brandFont
              font.pixelSize: Style.font.bodySmall
              wrapMode: Text.WordWrap
              textFormat: Text.PlainText
            }

            Row {
              visible: root.hotelError.length === 0
                && (root.hotelStatus.length > 0 || root.hotelBusy)
              spacing: Style.space(7)

              LfgSpinner {
                anchors.verticalCenter: parent.verticalCenter
                running: root.hotelBusy
                visible: root.hotelBusy
              }
              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.hotelBusy
                  ? "Opening a session with the supplier — this takes about a minute"
                  : root.hotelStatus
                color: root.hotelBusy ? root.brandOrange : root.inkMuted
                font.family: root.brandFont
                font.pixelSize: Style.font.bodySmall
                textFormat: Text.PlainText
              }
            }

            Text {
              visible: root.hotels.length === 0 && !root.hotelBusy
                && root.hotelStatus.length === 0 && root.hotelError.length === 0
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              topPadding: Style.space(30)
              text: "Free-cancellation, pay-later stays \u2014 on the same free token as flights."
              color: root.inkMuted
              font.family: root.brandFont
              font.pixelSize: Style.font.bodySmall
              textFormat: Text.PlainText
            }

            // -- results
            Flickable {
              id: hotelScroll
              width: parent.width
              height: parent.height - y - Style.space(4)
              contentWidth: width
              contentHeight: hotelCards.implicitHeight
              clip: true
              boundsBehavior: Flickable.StopAtBounds
              interactive: contentHeight > height

              Column {
                id: hotelCards
                width: hotelScroll.width
                spacing: Style.space(9)

                Repeater {
                  model: (root.hotelBusy && root.hotels.length === 0) ? 3 : 0
                  LfgSkeleton { width: hotelCards.width }
                }

                Repeater {
                  model: root.hotels

                  Rectangle {
                    id: stayCard
                    required property var modelData
                    width: hotelCards.width
                    height: Style.space(116)
                    radius: Style.space(16)
                    color: root.cardBg
                    border.width: 1
                    border.color: stayMouse.containsMouse
                      ? Model.PALETTE.tintOrangeEdge : root.hairline

                    // Booking a room means money, a supplier session and a real
                    // reservation, so it finishes on letsfg.co rather than in a
                    // bar panel. A rate is identified by session_id +
                    // combination_id_v2, which a URL does not carry, so this
                    // opens the hotels page rather than pretending to deep-link
                    // to this exact room.
                    MouseArea {
                      id: stayMouse
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onClicked: root.openOffer("https://letsfg.co/en/hotels")
                    }

                    Row {
                      anchors.fill: parent
                      anchors.margins: Style.space(12)
                      spacing: Style.space(16)

                      // Photo, masked to a rounded rectangle -- Item.clip is
                      // rectangular and would leave square corners.
                      Item {
                        width: Style.space(132)
                        height: parent.height

                        Rectangle {
                          id: stayShot
                          anchors.fill: parent
                          color: "#dfe5ee"
                          visible: false
                          layer.enabled: true
                          Image {
                            anchors.fill: parent
                            source: stayCard.modelData.image
                            fillMode: Image.PreserveAspectCrop
                            asynchronous: true
                            cache: true
                            sourceSize.width: 320
                            sourceSize.height: 240
                            smooth: true
                          }
                        }
                        Rectangle {
                          id: stayMask
                          anchors.fill: parent
                          radius: Style.space(12)
                          color: "black"
                          visible: false
                          layer.enabled: true
                        }
                        MultiEffect {
                          anchors.fill: parent
                          source: stayShot
                          maskEnabled: true
                          maskSource: stayMask
                        }
                      }

                      Column {
                        width: parent.width - Style.space(132 + 16 + 16 + 132)
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: Style.space(4)

                        Row {
                          spacing: Style.space(7)
                          Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: stayCard.modelData.name
                            color: root.inkPrimary
                            font.family: root.brandFont
                            font.pixelSize: Style.font.body + 1
                            font.weight: Font.Bold
                            elide: Text.ElideRight
                            textFormat: Text.PlainText
                          }
                          Text {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: stayCard.modelData.stars > 0
                            text: "\u2605".repeat(Math.max(0, stayCard.modelData.stars))
                            color: root.brandAmber
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            textFormat: Text.PlainText
                          }
                        }

                        Text {
                          width: parent.width
                          text: stayCard.modelData.address
                          color: root.inkMuted
                          font.family: root.brandFont
                          font.pixelSize: Style.font.bodySmall - 1
                          elide: Text.ElideRight
                          textFormat: Text.PlainText
                        }

                        Row {
                          spacing: Style.space(10)
                          Text {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: stayCard.modelData.rating.length > 0
                            text: stayCard.modelData.rating
                              + (stayCard.modelData.reviews > 0
                                 ? ("  \u00b7  " + stayCard.modelData.reviews + " reviews") : "")
                            color: "#1a9c5b"
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            font.weight: Font.DemiBold
                            textFormat: Text.PlainText
                          }
                        }

                        Row {
                          spacing: Style.space(8)
                          LfgIcon {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: stayCard.modelData.freeCancellation
                            icon: "circle-check"; tone: "green"
                            width: Style.space(13); height: width
                          }
                          Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: (stayCard.modelData.freeCancellation ? "Free cancellation" : "")
                              + (stayCard.modelData.room.length > 0
                                 ? ((stayCard.modelData.freeCancellation ? "  \u00b7  " : "")
                                    + stayCard.modelData.room) : "")
                            color: root.inkMuted
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            elide: Text.ElideRight
                            textFormat: Text.PlainText
                          }
                        }
                      }

                      Item {
                        width: Style.space(132)
                        height: parent.height

                        Column {
                          anchors.right: parent.right
                          anchors.verticalCenter: parent.verticalCenter
                          spacing: Style.space(2)

                          Text {
                            anchors.right: parent.right
                            text: stayCard.modelData.price
                            color: root.inkPrimary
                            font.family: root.brandFont
                            font.pixelSize: Style.font.body + 6
                            font.weight: Font.Bold
                            textFormat: Text.PlainText
                          }
                          Text {
                            anchors.right: parent.right
                            visible: stayCard.modelData.perNight.length > 0
                            text: stayCard.modelData.perNight + " / night"
                            color: root.inkMuted
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            textFormat: Text.PlainText
                          }
                          Text {
                            anchors.right: parent.right
                            visible: stayCard.modelData.dueNow.length > 0
                            text: stayCard.modelData.dueNow + " now"
                            color: root.inkFaint
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 2
                            textFormat: Text.PlainText
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        Column {
          width: parent.width
          height: shell.height - y
          visible: root.tab === "flights" && root.hasSearched
          spacing: Style.space(10)

          Flickable {
            width: parent.width
            height: Style.space(32)
            contentWidth: filterRow.width
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentWidth > width

            Row {
              id: filterRow
              spacing: Style.space(8)

              Row {
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(5)
                rightPadding: Style.space(6)
                // The count climbs as connectors report in, so the spinner is
                // the only thing distinguishing a slow search from a finished
                // one. Before any offers land there is no count worth showing,
                // so it says what it is doing instead of "0 flights found".
                LfgSpinner {
                  anchors.verticalCenter: parent.verticalCenter
                  running: root.busy
                  visible: root.busy
                }
                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  visible: root.visibleOffers.length > 0
                  text: String(root.visibleOffers.length)
                  color: root.inkPrimary
                  font.family: root.brandFont
                  font.pixelSize: Style.font.body
                  font.weight: Font.Bold
                  textFormat: Text.PlainText
                }
                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: root.visibleOffers.length === 0
                    ? "Searching hundreds of airlines…"
                    : (root.visibleOffers.length === root.offers.length
                       ? "flights found" : ("of " + root.offers.length))
                  color: root.inkMuted
                  font.family: root.brandFont
                  font.pixelSize: Style.font.bodySmall
                  textFormat: Text.PlainText
                }
                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  visible: root.busy && root.visibleOffers.length > 0
                  text: "·  still searching"
                  color: root.brandOrange
                  font.family: root.brandFont
                  font.pixelSize: Style.font.bodySmall - 1
                  font.weight: Font.DemiBold
                  textFormat: Text.PlainText
                }
              }

              LfgFilter {
                id: sortPill
                label: root.labelForKey(Model.SORTS, root.sortKey, "Best")
                leadingIcon: "arrow-up-down"
                active: root.sortKey !== "best"
                onTapped: root.openMenu("sort", Model.SORTS, sortPill)
              }
              LfgFilter {
                id: stopsPill
                label: root.labelForKey(Model.STOP_FILTERS, root.stopFilter, "Stops")
                active: root.stopFilter !== "any"
                onTapped: root.openMenu("stops", Model.STOP_FILTERS, stopsPill)
              }
              LfgFilter {
                id: timesPill
                label: root.labelForKey(Model.TIME_FILTERS, root.timeFilter, "Times")
                active: root.timeFilter !== "any"
                onTapped: root.openMenu("times", Model.TIME_FILTERS, timesPill)
              }
              LfgFilter {
                id: airlinesPill
                label: root.airlineFilter === "any" ? "Airlines" : root.airlineFilter
                active: root.airlineFilter !== "any"
                onTapped: root.openMenu("airlines", Model.airlinesIn(root.offers), airlinesPill)
              }
              LfgFilter {
                id: pricePill
                label: root.maxPriceFilter > 0
                  ? ("Under " + Model.money(root.maxPriceFilter, root.currency))
                  : "Max price"
                active: root.maxPriceFilter > 0
                onTapped: root.openMenu("price", Model.priceSteps(root.offers), pricePill)
              }
              LfgFilter {
                id: bagsPill
                label: root.labelForKey(Model.BAG_FILTERS, root.bagFilter, "Bags")
                active: root.bagFilter !== "any"
                onTapped: root.openMenu("bags", Model.BAG_FILTERS, bagsPill)
              }
              LfgFilter {
                label: "Clear"
                showChevron: false
                active: true
                visible: root.sortKey !== "best" || root.stopFilter !== "any"
                  || root.timeFilter !== "any" || root.airlineFilter !== "any"
                  || root.bagFilter !== "any" || root.maxPriceFilter > 0
                onTapped: root.resetFilters()
              }
            }
          }

          Text {
            visible: root.errorText.length > 0
            width: parent.width
            text: root.errorText
            color: root.brandOrange
            font.family: root.brandFont
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
            textFormat: Text.PlainText
          }

          Text {
            // Silent while the skeletons are up: "no flights found" during a
            // running search is just wrong.
            visible: root.errorText.length === 0 && root.visibleOffers.length === 0 && !root.busy
            width: parent.width
            text: root.offers.length > 0
              ? "No flights match these filters."
              : "No flights found for that route and date."
            color: root.inkMuted
            font.family: root.brandFont
            font.pixelSize: Style.font.bodySmall
            textFormat: Text.PlainText
          }

          Row {
            id: resultsRow
            width: parent.width
            height: parent.height - y - Style.space(4)
            spacing: Style.space(12)

            // The map only earns its space on a wide panel; below that the
            // list gets everything.
            readonly property bool mapVisible:
              root.showMap && root.mapCoord !== null && width > Style.space(760)

          Flickable {
            id: scroll
            width: resultsRow.mapVisible
              ? (resultsRow.width - Style.space(12) - Style.space(340))
              : resultsRow.width
            height: resultsRow.height
            contentWidth: width
            contentHeight: cards.implicitHeight
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            interactive: contentHeight > height

            Column {
              id: cards
              width: scroll.width
              spacing: Style.space(9)

              // Placeholders until the first offers land, so the list has
              // shape from the moment the search starts.
              Repeater {
                model: (root.busy && root.visibleOffers.length === 0) ? 3 : 0
                LfgSkeleton { width: cards.width }
              }

              Repeater {
                model: root.visibleOffers

                Rectangle {
                  id: offerCard
                  required property var modelData
                  width: cards.width
                  height: cardBody.implicitHeight + Style.space(28)
                  radius: Style.space(16)
                  color: root.cardBg
                  border.width: 1
                  border.color: cardMouse.containsMouse && modelData.bookingUrl.length > 0
                    ? Model.PALETTE.tintOrangeEdge : root.hairline

                  MouseArea {
                    id: cardMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: root.linkFor(offerCard.modelData).length > 0
                      ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: if (root.linkFor(offerCard.modelData).length > 0)
                      root.openOffer(root.linkFor(offerCard.modelData))
                  }

                  Row {
                    id: cardBody
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: Style.space(20)
                    anchors.rightMargin: Style.space(22)
                    spacing: Style.space(18)

                    Item {
                      width: Style.space(78)
                      height: carrierCol.implicitHeight
                      anchors.verticalCenter: parent.verticalCenter

                      Column {
                        id: carrierCol
                        anchors.horizontalCenter: parent.horizontalCenter
                        spacing: Style.space(6)

                        // One mark per carrier actually flown, like the site's
                        // AirlineLogoGroup. A KLM + EVA Air itinerary showed only
                        // KLM before, because the card rendered carriers[0].
                        Row {
                          anchors.horizontalCenter: parent.horizontalCenter
                          spacing: Style.space(4)

                          Repeater {
                            model: offerCard.modelData.carriers

                            Rectangle {
                              id: logoTile
                              required property var modelData
                              // Two marks still fit the 78px column; more and they
                              // would each be unreadable, so shrink past a pair.
                              readonly property int carrierCount: offerCard.modelData.carriers.length
                              width: carrierCount <= 1 ? Style.space(52)
                                   : carrierCount === 2 ? Style.space(36) : Style.space(24)
                              height: width
                              radius: Math.max(Style.space(6), width / 4.3)
                              color: logoImage.status === Image.Ready ? "transparent" : Model.PALETTE.tintOrange
                              border.width: logoImage.status === Image.Ready ? 0 : 1
                              border.color: Model.PALETTE.tintOrangeEdge

                              Image {
                                id: logoImage
                                anchors.fill: parent
                                // Kiwi first, avs.io second -- the same order and the
                                // same two CDNs app/airlineLogos.ts uses. The panel
                                // used to go straight to avs.io, which is the site's
                                // FALLBACK, so its logos never matched the website's.
                                // If both 404 the tile falls through to initials.
                                property bool triedFallback: false
                                source: root.showLogos ? logoTile.modelData.logoUrl : ""
                                asynchronous: true
                                cache: true
                                fillMode: Image.PreserveAspectFit
                                sourceSize.width: 100
                                sourceSize.height: 100
                                visible: status === Image.Ready
                                onStatusChanged: {
                                  if (status === Image.Error && !triedFallback
                                      && logoTile.modelData.logoFallbackUrl.length > 0
                                      && source !== logoTile.modelData.logoFallbackUrl) {
                                    triedFallback = true
                                    source = logoTile.modelData.logoFallbackUrl
                                  }
                                }
                              }

                              Text {
                                anchors.centerIn: parent
                                visible: logoImage.status !== Image.Ready
                                text: root.initialsFor(logoTile.modelData.name)
                                color: root.brandOrange
                                font.family: root.brandFont
                                font.pixelSize: logoTile.carrierCount > 2
                                  ? Style.font.bodySmall - 2 : Style.font.body
                                font.weight: Font.Bold
                                textFormat: Text.PlainText
                              }
                            }
                          }
                        }

                        Text {
                          anchors.horizontalCenter: parent.horizontalCenter
                          width: Style.space(78)
                          horizontalAlignment: Text.AlignHCenter
                          text: root.carrierNames(offerCard.modelData)
                          color: root.inkMuted
                          font.family: root.brandFont
                          font.pixelSize: Style.font.bodySmall - 1
                          wrapMode: Text.WordWrap
                          // A joined multi-carrier label ("easyJet, Vueling")
                          // needs a third line in a 78px column; at two it
                          // elided to the first carrier and the card read as a
                          // single-airline flight again.
                          maximumLineCount: (offerCard.modelData.carriers
                                             && offerCard.modelData.carriers.length > 1) ? 3 : 2
                          elide: Text.ElideRight
                          lineHeight: 0.92
                          textFormat: Text.PlainText
                        }
                      }
                    }

                    Column {
                      width: parent.width - Style.space(78 + 18 + 18 + 124)
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: Style.space(5)

                      Text {
                        text: offerCard.modelData.departDayLabel
                        color: root.inkMuted
                        font.family: root.brandFont
                        font.pixelSize: Style.font.bodySmall - 1
                        textFormat: Text.PlainText
                      }

                      Row {
                        width: parent.width
                        spacing: Style.space(12)

                        Column {
                          spacing: 0
                          Text {
                            text: offerCard.modelData.departTime
                            color: root.inkPrimary
                            font.family: root.brandFont
                            font.pixelSize: Style.font.body + 5
                            font.weight: Font.Bold
                            textFormat: Text.PlainText
                          }
                          Text {
                            text: offerCard.modelData.origin
                            color: root.inkMuted
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            textFormat: Text.PlainText
                          }
                        }

                        Item {
                          width: parent.width - Style.space(168)
                          height: Style.space(42)

                          Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            anchors.bottom: rail.top
                            anchors.bottomMargin: Style.space(3)
                            text: offerCard.modelData.duration
                            color: root.inkMuted
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            textFormat: Text.PlainText
                          }

                          Rectangle {
                            id: rail
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.rightMargin: Style.space(15)
                            height: 1
                            color: root.hairline
                          }

                          Rectangle {
                            anchors.verticalCenter: rail.verticalCenter
                            anchors.horizontalCenter: rail.horizontalCenter
                            visible: offerCard.modelData.stopCount > 0
                            width: Style.space(6); height: width; radius: width / 2
                            color: root.inkFaint
                          }

                          LfgIcon {
                            anchors.verticalCenter: rail.verticalCenter
                            anchors.right: parent.right
                            icon: "plane"; tone: "muted"
                            width: Style.space(13); height: width
                          }

                          Text {
                            anchors.horizontalCenter: parent.horizontalCenter
                            anchors.top: rail.bottom
                            anchors.topMargin: Style.space(3)
                            text: offerCard.modelData.stops
                              + (offerCard.modelData.stopVia.length > 0
                                 ? (" · " + offerCard.modelData.stopVia) : "")
                            color: offerCard.modelData.stopCount === 0 ? "#1a9c5b" : root.inkMuted
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            font.weight: offerCard.modelData.stopCount === 0 ? Font.DemiBold : Font.Normal
                            textFormat: Text.PlainText
                          }
                        }

                        Column {
                          spacing: 0
                          Row {
                            spacing: Style.space(2)
                            Text {
                              text: offerCard.modelData.arriveTime
                              color: root.inkPrimary
                              font.family: root.brandFont
                              font.pixelSize: Style.font.body + 5
                              font.weight: Font.Bold
                              textFormat: Text.PlainText
                            }
                            Text {
                              visible: offerCard.modelData.arrivesNextDay > 0
                              text: "+" + offerCard.modelData.arrivesNextDay
                              color: root.brandOrange
                              font.family: root.brandFont
                              font.pixelSize: Style.font.bodySmall - 2
                              textFormat: Text.PlainText
                            }
                          }
                          Text {
                            text: offerCard.modelData.destination
                            color: root.inkMuted
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            textFormat: Text.PlainText
                          }
                        }
                      }

                      Repeater {
                        model: offerCard.modelData.bagLines
                        Row {
                          required property var modelData
                          spacing: Style.space(7)
                          LfgIcon {
                            anchors.verticalCenter: parent.verticalCenter
                            icon: modelData.text.indexOf("Checked") === 0 ? "luggage" : "backpack"
                            tone: modelData.included ? "green" : "muted"
                            width: Style.space(14); height: width
                          }
                          Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: modelData.text
                            color: root.inkMuted
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            textFormat: Text.PlainText
                          }
                        }
                      }

                      // A genuinely long connection, called out the way the site
                      // calls it out: "8h 25m layover in Copenhagen (CPH)", in
                      // the same warm tone, above the amber warning pill. The
                      // site shows it from 6h; below that a connection is
                      // unremarkable and it says nothing.
                      Text {
                        visible: !!offerCard.modelData.layover
                        // airportsLoaded is in this binding on purpose: the
                        // airport table arrives asynchronously, and without it
                        // the label would keep whatever it resolved to on first
                        // render -- a bare "WAW" instead of "Warsaw (WAW)".
                        text: (root.airportsLoaded >= 0 && offerCard.modelData.layover)
                          ? Model.layoverLabel(offerCard.modelData.layover) : ""
                        color: "#c2410c"
                        font.family: root.brandFont
                        font.pixelSize: Style.font.bodySmall - 1
                        font.weight: Font.DemiBold
                        textFormat: Text.PlainText
                      }

                      // Starlink verdict, worded exactly as the site words it
                      // ("Starlink", "Starlink likely", "· some"). A confirmed
                      // verdict reads stronger than a likely one, as there.
                      Rectangle {
                        visible: !!offerCard.modelData.starlink
                        width: starRow.implicitWidth + Style.space(20)
                        height: Style.space(22)
                        radius: height / 2
                        color: "transparent"
                        border.width: 1
                        border.color: root.hairline
                        // Text only, deliberately: assets/icons carries exactly
                        // the glyphs tools/build-icons.py was run for, and
                        // naming one that was never rasterised renders a blank
                        // box on someone else's desktop rather than failing
                        // here. A confirmed verdict is inked darker than a
                        // likely one, which is the distinction the site draws.
                        Row {
                          id: starRow
                          anchors.centerIn: parent
                          Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: offerCard.modelData.starlink ? offerCard.modelData.starlink.label : ""
                            color: offerCard.modelData.starlink && offerCard.modelData.starlink.confirmed
                              ? root.inkPrimary : root.inkMuted
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 1
                            font.weight: Font.DemiBold
                            textFormat: Text.PlainText
                          }
                        }
                      }

                      Rectangle {
                        visible: offerCard.modelData.warning.length > 0
                        width: warnRow.implicitWidth + Style.space(20)
                        height: Style.space(22)
                        radius: height / 2
                        color: "#1ff5a623"
                        Row {
                          id: warnRow
                          anchors.centerIn: parent
                          spacing: Style.space(6)
                          LfgIcon {
                            anchors.verticalCenter: parent.verticalCenter
                            icon: "triangle-alert"; tone: "amber"
                            width: Style.space(13); height: width
                          }
                          Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: offerCard.modelData.warning
                            color: "#a86a00"
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 2
                            textFormat: Text.PlainText
                          }
                        }
                      }
                    }

                    Item {
                      width: Style.space(124)
                      height: priceCol.implicitHeight
                      anchors.verticalCenter: parent.verticalCenter

                      Column {
                        id: priceCol
                        anchors.right: parent.right
                        spacing: Style.space(3)

                        // Only on hover, so the row stays quiet until you reach
                        // for it -- but a card should never look inert.
                        Row {
                          anchors.right: parent.right
                          visible: cardMouse.containsMouse
                            && root.linkFor(offerCard.modelData).length > 0
                          spacing: Style.space(4)
                          Text {
                            anchors.verticalCenter: parent.verticalCenter
                            text: "open on letsfg.co"
                            color: root.brandOrange
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 2
                            font.weight: Font.DemiBold
                            textFormat: Text.PlainText
                          }
                          LfgIcon {
                            anchors.verticalCenter: parent.verticalCenter
                            icon: "arrow-right"; tone: "muted"
                            width: Style.space(11); height: width
                          }
                        }


                        Text {
                          anchors.right: parent.right
                          text: offerCard.modelData.price
                          color: root.inkPrimary
                          font.family: root.brandFont
                          font.pixelSize: Style.font.body + 9
                          font.weight: Font.Bold
                          textFormat: Text.PlainText
                        }

                        Rectangle {
                          anchors.right: parent.right
                          visible: offerCard.modelData.isCheapest
                          width: cheapLabel.implicitWidth + Style.space(14)
                          height: Style.space(19)
                          radius: height / 2
                          color: Model.PALETTE.tintOrange
                          Text {
                            id: cheapLabel
                            anchors.centerIn: parent
                            text: "cheapest"
                            color: root.brandOrange
                            font.family: root.brandFont
                            font.pixelSize: Style.font.bodySmall - 2
                            font.weight: Font.DemiBold
                            textFormat: Text.PlainText
                          }
                        }

                        Text {
                          anchors.right: parent.right
                          visible: offerCard.modelData.isCombo
                          text: "mixed airlines"
                          color: root.inkFaint
                          font.family: root.brandFont
                          font.pixelSize: Style.font.bodySmall - 2
                          textFormat: Text.PlainText
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          // ---- Map. Raster tiles composed in plain QML: the site uses
          //      MapLibre with vector tiles, which needs a renderer QML does
          //      not have, and QtLocation is a separate package the shell's Qt
          //      may not ship. Tiles are just images.
          Item {
            id: mapPane
            visible: resultsRow.mapVisible
            width: Style.space(340)
            height: resultsRow.height

            readonly property var grid: (root.mapCoord && width > 0 && height > 0)
              ? Model.tileGrid(root.mapCoord.lat, root.mapCoord.lon, root.mapZoom, width, height)
              : ({ tiles: [], centerX: 0, centerY: 0 })

            // The tiles, drawn into a layer and masked to a rounded rect.
            // Item.clip is rectangular and ignores radius, which is why the
            // map had square corners inside a rounded panel.
            Item {
              id: tileLayer
              anchors.fill: parent
              visible: false
              layer.enabled: true

              Rectangle {
                anchors.fill: parent
                color: "#e8ecf3"
              }

              Repeater {
                model: mapPane.grid.tiles

                Image {
                  required property var modelData
                  x: modelData.px
                  y: modelData.py
                  width: Model.TILE_SIZE
                  height: Model.TILE_SIZE
                  source: modelData.url
                  asynchronous: true
                  cache: true
                  smooth: true
                }
              }
            }

            Rectangle {
              id: mapMask
              anchors.fill: parent
              radius: Style.space(16)
              color: "black"
              visible: false
              layer.enabled: true
            }

            MultiEffect {
              anchors.fill: parent
              source: tileLayer
              maskEnabled: true
              maskSource: mapMask
            }

            // Overlays: ordinary children, so they still take clicks.
            Item {
              anchors.fill: parent

              // The arrival airport. The pin's point is its bottom centre.
              LfgIcon {
                x: mapPane.grid.centerX - width / 2
                y: mapPane.grid.centerY - height
                width: Style.space(30)
                height: Style.space(30)
                icon: "map-pin"
                tone: "orange"
              }

              // Ground transport, pilled onto the map the way the site does.
              Rectangle {
                visible: root.transferInfo.ok
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                anchors.bottomMargin: Style.space(26)
                width: Math.min(parent.width - Style.space(20), trRow.implicitWidth + Style.space(24))
                height: Style.space(32)
                radius: height / 2
                color: root.cardBg
                border.width: 1
                border.color: root.hairline

                Row {
                  id: trRow
                  anchors.centerIn: parent
                  spacing: Style.space(7)

                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: root.destCode
                    color: root.brandOrange
                    font.family: root.brandFont
                    font.pixelSize: Style.font.bodySmall
                    font.weight: Font.Bold
                    textFormat: Text.PlainText
                  }
                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: root.transferInfo.price
                      + (root.transferInfo.minutes > 0
                         ? ("  \u00b7  " + root.transferInfo.minutes + "m") : "")
                    color: root.inkPrimary
                    font.family: root.brandFont
                    font.pixelSize: Style.font.bodySmall
                    font.weight: Font.DemiBold
                    textFormat: Text.PlainText
                  }
                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "to city center"
                    color: root.inkMuted
                    font.family: root.brandFont
                    font.pixelSize: Style.font.bodySmall - 1
                    textFormat: Text.PlainText
                  }
                }
              }

              // Required by the tile licence.
              Rectangle {
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                anchors.margins: Style.space(4)
                width: attribution.implicitWidth + Style.space(10)
                height: Style.space(15)
                radius: Style.space(4)
                color: Qt.rgba(1, 1, 1, 0.78)
                Text {
                  id: attribution
                  anchors.centerIn: parent
                  text: Model.TILE_ATTRIBUTION
                  color: root.inkMuted
                  font.family: root.brandFont
                  font.pixelSize: Style.font.bodySmall - 3
                  textFormat: Text.PlainText
                }
              }

              Column {
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: Style.space(8)
                spacing: Style.space(5)

                LfgMapBtn {
                  glyph: "plus"
                  onTapped: if (root.mapZoom < 15) root.mapZoom = root.mapZoom + 1
                }
                LfgMapBtn {
                  glyph: "minus"
                  onTapped: if (root.mapZoom > 3) root.mapZoom = root.mapZoom - 1
                }
              }
            }
          }
          }

        }
      }

      // ---- Menu overlay ------------------------------------------------

      Item {
        id: menuLayer
        anchors.fill: parent
        z: 100
        visible: root.menuFor.length > 0

        MouseArea {
          anchors.fill: parent
          onClicked: root.menuFor = ""
        }

        Rectangle {
          id: menuBox
          x: Math.min(root.menuX, menuLayer.width - width - Style.space(6))
          y: root.menuY
          // Sized from the OPTION COUNT, never from the laid-out Column:
          // deriving it from menuCol.implicitWidth while menuCol's width came
          // from this Rectangle was a binding cycle, which Qt reported as a
          // polish() loop rather than as a size error.
          width: Style.space(226)
          height: root.menuOptions.length * Style.space(30) + Style.space(12)
          radius: Style.space(12)
          color: root.cardBg
          border.width: 1
          border.color: root.hairline

          Column {
            id: menuCol
            anchors.centerIn: parent
            width: menuBox.width - Style.space(12)

            Repeater {
              model: root.menuOptions

              Rectangle {
                required property var modelData
                width: menuCol.width
                height: Style.space(30)
                radius: Style.space(8)
                color: optMouse.containsMouse ? Model.PALETTE.tintOrange : "transparent"

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.left: parent.left
                  anchors.leftMargin: Style.space(10)
                  width: parent.width - Style.space(34)
                  text: modelData.label
                  color: root.currentMenuKey() === modelData.key ? root.brandOrange : root.inkPrimary
                  font.family: root.brandFont
                  font.pixelSize: Style.font.bodySmall
                  font.weight: root.currentMenuKey() === modelData.key ? Font.DemiBold : Font.Normal
                  elide: Text.ElideRight
                  textFormat: Text.PlainText
                }

                LfgIcon {
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.right: parent.right
                  anchors.rightMargin: Style.space(10)
                  visible: root.currentMenuKey() === modelData.key
                  icon: "circle-check"; tone: "orange"
                  width: Style.space(14); height: width
                }

                MouseArea {
                  id: optMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.chooseMenu(modelData.key)
                }
              }
            }
          }
        }
      }
    }
  }

  // ---- Small building blocks ----------------------------------------------
  //
  // Inline components are compiled as separate types and cannot see this
  // document's ids, so they read colours from Model.PALETTE rather than root.

  // Icons are pre-rasterised per colour by tools/build-icons.py: Qt renders SVG
  // only when the shell's Qt ships QtSvg, and recolouring a monochrome image at
  // runtime needs QtQuick.Effects. Both are optional modules, and a missing one
  // would show up as blank icons on someone else's desktop.
  component LfgIcon: Image {
    property string icon: ""
    property string tone: "muted"
    source: icon.length > 0
      ? Qt.resolvedUrl("assets/icons/" + icon + "-" + tone + ".png") : ""
    fillMode: Image.PreserveAspectFit
    sourceSize.width: 48
    sourceSize.height: 48
    smooth: true
    mipmap: true
  }

  component LfgTab: Item {
    id: tab
    property string label: ""
    property string icon: ""
    property bool selected: false
    signal tapped()

    implicitWidth: tabRow.implicitWidth + Style.space(20)
    implicitHeight: Style.space(30)
    width: implicitWidth
    height: implicitHeight

    Rectangle {
      anchors.fill: parent
      radius: height / 2
      color: tab.selected ? Model.PALETTE.tintOrange
                          : (tabMouse.containsMouse ? Qt.rgba(0, 0, 0, 0.04) : "transparent")
    }

    Row {
      id: tabRow
      anchors.centerIn: parent
      spacing: Style.space(7)
      LfgIcon {
        anchors.verticalCenter: parent.verticalCenter
        icon: tab.icon
        tone: tab.selected ? "orange" : "muted"
        width: Style.space(17); height: width
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: tab.label
        color: tab.selected ? Model.PALETTE.brandOrange : Model.PALETTE.inkMuted
        font.family: Model.PALETTE.font
        font.pixelSize: Style.font.body
        font.weight: tab.selected ? Font.DemiBold : Font.Normal
        textFormat: Text.PlainText
      }
    }

    MouseArea {
      id: tabMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: tab.tapped()
    }
  }

  component LfgFilter: Item {
    id: pill
    property string label: ""
    property string leadingIcon: ""
    property bool active: false
    property bool showChevron: true
    signal tapped()

    implicitWidth: pillRow.implicitWidth + Style.space(26)
    implicitHeight: Style.space(30)
    width: implicitWidth
    height: implicitHeight

    Rectangle {
      anchors.fill: parent
      radius: height / 2
      color: pill.active ? Model.PALETTE.tintOrange
                         : (fMouse.containsMouse ? Qt.rgba(0, 0, 0, 0.04) : Model.PALETTE.card)
      border.width: 1
      border.color: pill.active ? Model.PALETTE.tintOrangeEdge : Model.PALETTE.hairline
    }

    Row {
      id: pillRow
      anchors.centerIn: parent
      spacing: Style.space(6)

      LfgIcon {
        anchors.verticalCenter: parent.verticalCenter
        visible: pill.leadingIcon.length > 0
        icon: pill.leadingIcon
        tone: pill.active ? "orange" : "muted"
        width: Style.space(13); height: width
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: pill.label
        color: pill.active ? Model.PALETTE.brandOrange : Model.PALETTE.ink
        font.family: Model.PALETTE.font
        font.pixelSize: Style.font.bodySmall
        font.weight: pill.active ? Font.DemiBold : Font.Normal
        textFormat: Text.PlainText
      }
      LfgIcon {
        anchors.verticalCenter: parent.verticalCenter
        visible: pill.showChevron
        icon: "chevron-down"
        tone: pill.active ? "orange" : "faint"
        width: Style.space(12); height: width
      }
    }

    MouseArea {
      id: fMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: pill.tapped()
    }
  }

  component LfgStep: Item {
    id: step
    // An icon name, so the stepper uses the same set as everything else.
    property string glyph: "plus"
    // No `enabled` property of its own: Item already has one, and shadowing it
    // both warns and loses the built-in behaviour of blocking input when false.
    signal tapped()

    width: Style.space(23)
    height: Style.space(23)

    Rectangle {
      anchors.fill: parent
      radius: width / 2
      color: stepMouse.containsMouse && step.enabled ? Qt.rgba(0, 0, 0, 0.05) : "transparent"
      border.width: 1
      border.color: Model.PALETTE.hairline
    }

    LfgIcon {
      anchors.centerIn: parent
      icon: step.glyph
      tone: step.enabled ? "muted" : "faint"
      width: Style.space(12); height: width
    }

    MouseArea {
      id: stepMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: step.enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
      onClicked: if (step.enabled) step.tapped()
    }
  }

  // A card-shaped placeholder that breathes, so a running search looks like
  // one. Same height and column positions as a real card, which is what stops
  // the list jumping when the real ones replace it.
  component LfgSkeleton: Rectangle {
    id: sk
    height: Style.space(112)
    radius: Style.space(16)
    color: Model.PALETTE.card
    border.width: 1
    border.color: Model.PALETTE.hairline

    // One animation drives every block, so they pulse together rather than
    // shimmering out of step.
    property real pulse: 0.55
    SequentialAnimation on pulse {
      running: sk.visible
      loops: Animation.Infinite
      NumberAnimation { to: 1.0; duration: 720; easing.type: Easing.InOutSine }
      NumberAnimation { to: 0.55; duration: 720; easing.type: Easing.InOutSine }
    }

    Row {
      anchors.fill: parent
      anchors.leftMargin: Style.space(20)
      anchors.rightMargin: Style.space(22)
      anchors.topMargin: Style.space(18)
      anchors.bottomMargin: Style.space(18)
      spacing: Style.space(18)

      Column {
        width: Style.space(78)
        spacing: Style.space(7)
        Rectangle {
          anchors.horizontalCenter: parent.horizontalCenter
          width: Style.space(52); height: width; radius: Style.space(12)
          color: Model.PALETTE.hairline
          opacity: sk.pulse
        }
        Rectangle {
          anchors.horizontalCenter: parent.horizontalCenter
          width: Style.space(52); height: Style.space(8); radius: Style.space(4)
          color: Model.PALETTE.hairline
          opacity: sk.pulse
        }
      }

      Column {
        width: parent.width - Style.space(78 + 18 + 18 + 124)
        anchors.verticalCenter: parent.verticalCenter
        spacing: Style.space(9)
        Rectangle {
          width: Style.space(74); height: Style.space(9); radius: Style.space(4)
          color: Model.PALETTE.hairline
          opacity: sk.pulse
        }
        Rectangle {
          width: parent.width * 0.82; height: Style.space(15); radius: Style.space(5)
          color: Model.PALETTE.hairline
          opacity: sk.pulse
        }
        Rectangle {
          width: parent.width * 0.55; height: Style.space(9); radius: Style.space(4)
          color: Model.PALETTE.hairline
          opacity: sk.pulse
        }
      }

      Item {
        width: Style.space(124)
        height: parent.height
        Rectangle {
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          width: Style.space(86); height: Style.space(20); radius: Style.space(6)
          color: Model.PALETTE.hairline
          opacity: sk.pulse
        }
      }
    }
  }

  // A small indeterminate spinner. Cheap, and unlike a progress bar it does
  // not imply a completion percentage nobody can honestly report: the search
  // finishes when the connectors do.
  component LfgSpinner: Item {
    id: spin
    property bool running: false
    width: Style.space(13)
    height: Style.space(13)

    // A faint ring with a dot going round it. An arc would need QtQuick.Shapes
    // or Canvas; a rotated bordered rectangle (the first attempt) just read as
    // a smudge at this size.
    Rectangle {
      anchors.fill: parent
      radius: width / 2
      color: "transparent"
      border.width: 1.5
      border.color: Model.PALETTE.tintOrangeMid
    }

    Item {
      anchors.fill: parent
      RotationAnimator on rotation {
        running: spin.running
        loops: Animation.Infinite
        from: 0
        to: 360
        duration: 850
      }

      Rectangle {
        anchors.horizontalCenter: parent.horizontalCenter
        y: -1
        width: Math.round(spin.width * 0.42)
        height: width
        radius: width / 2
        color: Model.PALETTE.brandOrange
      }
    }
  }

  component LfgMapBtn: Item {
    id: mb
    property string glyph: "plus"
    signal tapped()

    width: Style.space(26)
    height: Style.space(26)

    Rectangle {
      anchors.fill: parent
      radius: Style.space(7)
      color: mbMouse.containsMouse ? "#ffffff" : Qt.rgba(1, 1, 1, 0.86)
      border.width: 1
      border.color: Model.PALETTE.hairline
    }
    LfgIcon {
      anchors.centerIn: parent
      icon: mb.glyph
      tone: "muted"
      width: Style.space(13); height: width
    }
    MouseArea {
      id: mbMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: mb.tapped()
    }
  }

  component LfgRoundBtn: Item {
    id: rb
    property string icon: "arrow-right"
    property bool flipped: false
    signal tapped()

    width: Style.space(26)
    height: Style.space(26)

    Rectangle {
      anchors.fill: parent
      radius: width / 2
      color: rbMouse.containsMouse ? Qt.rgba(0, 0, 0, 0.05) : "transparent"
    }
    LfgIcon {
      anchors.centerIn: parent
      icon: rb.icon
      tone: "muted"
      width: Style.space(15); height: width
      rotation: rb.flipped ? 180 : 0
    }
    MouseArea {
      id: rbMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: rb.tapped()
    }
  }
}
