// Pure logic for the LetsFG bar widget and its panel: input validation,
// response parsing, sanitisation, and the poll state machine.
//
// Everything here is Qt-free and side-effect-free so it can be unit tested
// under node (test/model-test.js). The QML owns the network calls, the file
// read, and every pixel; this file owns every decision about what is safe to
// send, safe to parse, and safe to render.
//
// ---------------------------------------------------------------------------
// SECURITY INVARIANTS — these are the reason this file is separate.
//
//   1. The API host is a constant. There is no base-URL override, from the
//      environment or anywhere else. An override is a token-exfiltration
//      switch and its only upside is developer convenience, which a fork can
//      patch in. Every request URL is built by a function here and re-checked
//      against the constant before it is handed to XMLHttpRequest.
//
//   2. The bearer token lives in a closure (createSession) and is never a QML
//      property. QML plugins share one engine, so a declared property is
//      walkable by anything else the user has installed. Callers get
//      applyTo(xhr) and a redacted status object — never the string.
//
//   3. Every value that came off the network is untrusted. It is length-capped
//      and stripped of control characters before it can reach a Text item, and
//      a URL is opened only if it matches an https allowlist. This is an
//      allowlist and not a denylist on purpose: the string originates upstream.
//
//   4. Nothing here starts a request. There is no timer and no polling clock.
//      The panel calls in response to a click or an Enter key, and that is the
//      only way a search begins — see README "Why there is no auto-refresh".
// ---------------------------------------------------------------------------

// ---- Constants -------------------------------------------------------------

// Pinned. See invariant 1.
var API_ORIGIN = "https://letsfg.co"

// A shell plugin lives in the same process as the bar. A multi-megabyte body
// handed to JSON.parse freezes the whole desktop, so the body is measured
// before it is parsed and an oversized one is an error, not a slow path.
var MAX_RESPONSE_CHARS = 2 * 1024 * 1024

// Caps on anything rendered. The API is ours, but "ours" is not a safety
// property -- a compromised or spoofed response must not be able to paint
// outside the panel or wedge the layout.
// Filters and sorts run over what is already in hand, so the panel keeps a
// bigger working set than it shows at once -- narrowing to "nonstop, cabin bag
// included" is worthless against 25 rows.
// Hard ceiling on rendered cards. This is a RENDER guard, not a product
// decision -- it exists because the results list is a Repeater inside a
// Column, so every delegate is instantiated rather than virtualised.
//
// It was 60, and 60 is what the panel showed for GDN->LAX while letsfg.co
// showed 200+. That was not a cache, not the poll loop and not the server: it
// was this constant, silently slicing the ranked list in summarizeOffers.
//
// Measured on the preview harness (same fixture shape, screenshot run):
//   6 offers -> 3949ms      250 offers -> 4646ms
// i.e. ~700ms marginal for 250 cards, and most of that baseline is Python +
// Qt startup which does not exist inside a running Omarchy shell. 1000 leaves
// real searches uncapped (the largest seen here was 256 after dedup) while
// still bounding a pathological payload.
//
// If this ever needs to go higher, convert the Repeater to a ListView so the
// delegates virtualise, rather than raising the number again.
var MAX_RENDERED_OFFERS = 1000
var MAX_FIELD_CHARS = 120
var MAX_URL_CHARS = 2048

// Poll shape. Mirrors sdk/mcp/src/index.ts: poll first and sleep after, so a
// search that is already finished is reported finished immediately.
var POLL_INTERVAL_MS = 1200

// After a search reports terminal, letsfg.co keeps polling on a slower cadence
// while a late merge is still inbound (GF enrich lands 16-75s past completion,
// the split-ticket probe ~25-45s). Same numbers as the site: GRACE_POLL_MS 3000,
// GRACE_POLLS 40 — a ~120s ceiling that the flag normally ends far sooner.
var GRACE_POLL_MS = 3000
var GRACE_POLLS = 40

// The watchdog budget for the late-merge wait, which is a different phase from
// the search: the search has already answered. Covers the full grace window
// (40 x 3s) plus room for one slow poll on top.
var GRACE_WATCHDOG_MS = GRACE_POLL_MS * GRACE_POLLS + 30000
var POLL_TIMEOUT_MS = 90000
var MAX_POLLS = Math.ceil(POLL_TIMEOUT_MS / POLL_INTERVAL_MS)

// Early return. The slowest one or two meta connectors routinely run 40-50s
// after every other source has finished, and the tail adds more offers rather
// than a cheaper one. Holding the panel open on that tail is latency for
// nothing.

// Client-side throttle. The server rate-limits per token, but the first line
// of defence against a stuck panel is here, in the process doing the asking.
var MIN_SEARCH_INTERVAL_MS = 5000
var BREAKER_TRIP_AFTER = 3

// The token file the official CLI writes (`letsfg auth`). Same 1h skew buffer
// the Python SDK applies, so the panel and the CLI agree on "expired".
var TOKEN_EXPIRY_BUFFER_SEC = 3600

// ---- Palette -----------------------------------------------------------
//
// Lifted from the live letsfg.co computed styles, not eyeballed: the page
// ground is rgb(248,249,253), cards are white, ink is rgb(15,15,15), muted
// text is rgba(18,44,58,.62), and the brand ramp is #ff5b2c -> #ff9116 ->
// #ffd84d in Lexend.
//
// It lives HERE rather than as QML properties because QML inline components
// (LfgChip, LfgField, LfgStep in Panel.qml) are compiled as separate types and
// cannot see the enclosing document's ids -- `root.inkMuted` does not resolve
// inside them, but a file-level JS import does.
//
// Alpha colours are QML's 8-digit #AARRGGBB, not CSS #RRGGBBAA.
var PALETTE = {
  brandOrange: "#ff5b2c",
  brandAmber: "#ff9116",
  brandYellow: "#ffd84d",
  surface: "#f8f9fd",
  card: "#ffffff",
  ink: "#0f0f0f",
  inkMuted: "#9e122c3a",         // rgba(18,44,58,.62)
  inkFaint: "#6b122c3a",         // rgba(18,44,58,.42)
  hairline: "#1f122c3a",         // rgba(18,44,58,.12)
  tintOrange: "#1fff5b2c",       // orange @ 12%
  tintOrangeMid: "#3dff5b2c",    // orange @ 24%
  tintOrangeEdge: "#73ff5b2c",   // orange @ 45%
  glow: "#21ff8c2d",             // the brand shadow under the search frame
  hoverInk: "#0d000000",
  // Lexend is the site's face. Qt falls back to the default sans if it is not
  // installed, which is why the fallback is named rather than left to chance.
  font: "Lexend",
  fontFallback: "DejaVu Sans"
}

// ---- Airline logos ---------------------------------------------------------
//
// letsfg.co renders carrier marks from a third-party CDN, keyed by IATA code:
//   https://pics.avs.io/100/100/{IATA}.png
// The plugin does the same, so a card looks like a card on the site.
//
// This is the ONE host besides letsfg.co that the plugin talks to, and it is a
// deliberate, disclosed exception -- see README "Privileges and data".
// It is made safe by construction rather than by trusting the response:
//
//   * the URL is BUILT from `airline_code` after that code is validated as
//     exactly two A-Z0-9 characters. A URL string in the payload is never
//     followed, so a hostile response cannot point the image anywhere.
//   * the result is re-checked against the pinned CDN prefix before use.
//   * an empty return means "no logo", and the card falls back to initials.
// The site's two logo sources, in the site's order. app/airlineLogos.ts uses
// Kiwi as the PRIMARY (clean square marks) and falls back to avs.io only when
// Kiwi 404s. The panel had avs.io as its ONLY source -- i.e. the site's
// fallback -- which is why its logos looked different from the website's.
var LOGO_CDN_PRIMARY = "https://images.kiwi.com/airlines/64/"
var LOGO_CDN_FALLBACK = "https://pics.avs.io/100/100/"

// Wizz sub-brands reuse the parent's mark (IATA_LOGO_CODE_ALIASES on the site).
var LOGO_ALIASES = { "W4": "W6", "W9": "W6" }

// Codes with no art on Kiwi -- go straight to avs.io, as getAirlineLogoUrl does.
var LOGO_KIWI_MISSING = { "WN": true }

function normalizeLogoCode(code) {
  var c = safeText(code, 8).toUpperCase()
  if (!/^[A-Z0-9]{2}$/.test(c)) return ""
  if (LOGO_ALIASES.hasOwnProperty(c)) c = LOGO_ALIASES[c]
  return c
}

function airlineLogoUrl(code) {
  var c = normalizeLogoCode(code)
  if (c === "") return ""
  var base = LOGO_KIWI_MISSING.hasOwnProperty(c) ? LOGO_CDN_FALLBACK : LOGO_CDN_PRIMARY
  var url = base + c + ".png"
  // Both bases are pinned constants; re-check so a code can never escape them.
  if (url.indexOf(LOGO_CDN_PRIMARY) !== 0 && url.indexOf(LOGO_CDN_FALLBACK) !== 0) return ""
  return url
}

/** Second attempt once the primary 404s -- mirrors getAirlineLogoFallbackUrl. */
function airlineLogoFallbackUrl(code) {
  var c = normalizeLogoCode(code)
  if (c === "") return ""
  var url = LOGO_CDN_FALLBACK + c + ".png"
  if (url.indexOf(LOGO_CDN_FALLBACK) !== 0) return ""
  return url
}

// Every distinct carrier actually flown, in itinerary order -- the site's
// distinctAirlinesOf(): it scans EVERY segment of the outbound and inbound
// legs, because one leg can mix carriers across its own connections, and dedups
// by airline code. A GDN->BKK offer flown KLM then EVA Air is two carriers, and
// the panel was showing only the first.
function distinctCarriers(offer) {
  var out = [], seen = {}, i, segs = []
  if (!offer || typeof offer !== "object") return out
  if (Array.isArray(offer.segments)) segs = segs.concat(offer.segments)
  if (offer.inbound && Array.isArray(offer.inbound.segments)) segs = segs.concat(offer.inbound.segments)

  for (i = 0; i < segs.length; i++) {
    var seg = segs[i]
    if (!seg || typeof seg !== "object") continue
    var code = safeText(seg.airline_code, 8).toUpperCase()
    var name = safeText(seg.airline, 48) || code
    if (code === "" && name === "") continue
    var key = code || name
    if (Object.prototype.hasOwnProperty.call(seen, key)) continue
    seen[key] = true
    out.push({ code: code, name: name,
               logoUrl: airlineLogoUrl(code), logoFallbackUrl: airlineLogoFallbackUrl(code) })
  }

  // Segment data is not always present. Fall back to the offer's own carrier so
  // a card never loses its airline entirely.
  if (out.length === 0) {
    var oc = safeText(offer.airline_code, 8).toUpperCase()
    var on = safeText(offer.airline, 48) || oc
    if (on !== "" || oc !== "") {
      out.push({ code: oc, name: on,
                 logoUrl: airlineLogoUrl(oc), logoFallbackUrl: airlineLogoFallbackUrl(oc) })
    }
  }
  return out
}

// ---- Baggage ---------------------------------------------------------------
//
// Offers carry `ancillaries.{cabin_bag,checked_bag}` as
// { included: bool, price: number, currency: string, description: string }.
// Only a strict `included === true` counts: a missing block means the source
// did not say, which is not the same as "no bag", and claiming otherwise about
// a fare someone is about to buy would be worse than saying nothing.
function bagsFor(offer) {
  var out = { cabin: false, checked: false, any: false }
  if (!offer || typeof offer !== "object") return out
  var a = offer.ancillaries
  if (!a || typeof a !== "object") return out
  if (a.cabin_bag && typeof a.cabin_bag === "object" && a.cabin_bag.included === true) out.cabin = true
  if (a.checked_bag && typeof a.checked_bag === "object" && a.checked_bag.included === true) out.checked = true
  out.any = out.cabin || out.checked
  return out
}

// A 429 from the Bearer lane puts the delay in the BODY --
// {"error":"...","code":"AGENT_RATE_LIMITED","retry_after_seconds":600} --
// and not only in a Retry-After header. Reading just the header meant the
// panel un-blocked itself immediately after a rate limit it had been told to
// wait 10 minutes for.
function retryAfterFromBody(text) {
  var parsed = parseJsonBody(text)
  if (!parsed.ok) return 0
  var secs = Number(parsed.value.retry_after_seconds)
  if (!isFinite(secs) || secs <= 0) return 0
  return Math.min(secs, 3600) * 1000
}

// "Wizz Air Malta" -> "WA". The site shows carrier logos; those are remote
// images and this plugin fetches nothing but the API, so initials stand in.
function initials(name) {
  var s = safeText(name, 48)
  if (s.length === 0) return "?"
  var words = s.split(" ").filter(function (w) { return w.length > 0 })
  if (words.length === 0) return "?"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
}

var CABINS = [
  { code: "M", label: "Economy" },
  { code: "W", label: "Premium" },
  { code: "C", label: "Business" },
  { code: "F", label: "First" }
]

// ---- Sanitisation ----------------------------------------------------------

// Strip C0 and C1 control characters (including the ANSI escape introducer and
// the bidi overrides that let a string render as something other than what it
// is), collapse whitespace, and cap the length. Everything that came off the
// network goes through this before it is allowed near a Text item.
function safeText(value, maxChars) {
  if (value === null || value === undefined) return ""
  var s = String(value)
  var cap = maxChars > 0 ? maxChars : MAX_FIELD_CHARS
  var out = ""
  for (var i = 0; i < s.length && out.length < cap; i++) {
    var c = s.charCodeAt(i)
    // C0 controls, DEL, C1 controls.
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) { out += " "; continue }
    // Bidi overrides and embedding marks: a right-to-left override can make
    // "moc.live/gro.gfstel" paint as a letsfg.co URL.
    if (c >= 0x202a && c <= 0x202e) continue
    if (c >= 0x2066 && c <= 0x2069) continue
    // Zero-width and BOM: invisible, so they can hide a homograph split.
    if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0xfeff) continue
    out += s.charAt(i)
  }
  return out.replace(/\s+/g, " ").trim()
}

// An https URL we are willing to hand to the desktop's URL opener.
//
// Allowlist, not denylist. The scheme must be exactly https (so javascript:,
// data:, file: and vbscript: are all excluded by construction rather than by
// enumeration), the authority must look like a hostname, and the whole string
// must be free of control characters, quotes, backslashes and whitespace --
// the characters that let a URL break out of whatever it is embedded in.
//
// Returns the URL, or "" if it is not acceptable. "" must be treated as
// "do not open", never as "open something else".
function safeHttpsUrl(value) {
  if (value === null || value === undefined) return ""
  var s = String(value)
  if (s.length === 0 || s.length > MAX_URL_CHARS) return ""
  // Reject on the raw string before any parsing: no control chars, no space,
  // no quote, no backslash, no angle bracket.
  if (/[\x00-\x20\x7f-\x9f"'`\\<>{}|^]/.test(s)) return ""
  // Scheme must be literally "https://" -- lowercase, no leading whitespace,
  // no "javascript:https://" prefix games.
  if (s.indexOf("https://") !== 0) return ""
  var rest = s.slice(8)
  // Strip any userinfo attempt: https://evil.com@letsfg.co reads as letsfg.co
  // to a human and resolves to evil.com in some parsers. Refuse outright.
  var authorityEnd = rest.search(/[\/?#]/)
  var authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd)
  if (authority.indexOf("@") !== -1) return ""
  // Hostname, optional port. Letters, digits, dot, hyphen only -- this also
  // rejects the punycode-adjacent unicode homographs.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?(?::[0-9]{1,5})?$/.test(authority)) return ""
  if (authority.indexOf("..") !== -1) return ""
  return s
}

// ---- Request URLs ----------------------------------------------------------

// Every outbound URL is built here and re-checked against the pinned origin.
// A caller cannot construct a request to anywhere else without editing this
// function, which is the point.
function apiUrl(path) {
  if (typeof path !== "string" || path.indexOf("/") !== 0) throw new Error("bad api path")
  if (/[\x00-\x20\x7f-\x9f"'`\\<>]/.test(path)) throw new Error("bad api path")
  var url = API_ORIGIN + path
  if (url.indexOf(API_ORIGIN + "/") !== 0) throw new Error("api url escaped the pinned origin")
  return url
}

function searchUrl() { return apiUrl("/api/search") }

// The link a result card opens.
//
// /api/search offers carry NO booking_url -- not one, in a 244-offer response.
// The site builds the link itself, and this is that same shape:
//
//   https://letsfg.co/en?stage=results&sid=<search_id>&o=GDN&d=WAW
//                       &dep=2026-09-21&cur=USD&offer=<offer_id>
//
// Every component is validated before it is encoded, and the finished string
// is re-checked against the pinned origin -- an id that came off the network
// is going into a URL a browser will open, so it is treated as untrusted.
// Returns "" when anything is missing, and "" means "not clickable".
function offerUrl(searchId, offer, opts) {
  var sid = String(searchId === null || searchId === undefined ? "" : searchId)
  if (!/^[A-Za-z0-9_\-]{1,120}$/.test(sid)) return ""
  if (!offer || typeof offer !== "object") return ""

  var oid = String(offer.offerId === null || offer.offerId === undefined ? "" : offer.offerId)
  if (!/^[A-Za-z0-9_\-]{1,120}$/.test(oid)) return ""

  var o = opts || {}
  // The SEARCH's origin/destination win over this offer's. They are not the
  // same thing whenever the search was for a city with several airports: a
  // GDN -> SEL search (all Seoul airports) returns offers landing at ICN or
  // GMP, and this used to take the offer's, so opening a Finnair result sent
  // the site to a NEW "GDN -> GMP" search instead of the GDN -> SEL one the
  // user had actually run -- a different route, a different result set, and a
  // second live search nobody asked for.
  //
  // The offer's own codes stay as the fallback, for the case where the caller
  // does not know what was searched.
  var origin = normalizeIata(o.origin || offer.origin)
  var dest = normalizeIata(o.destination || offer.destination)
  if (!isValidIata(origin) || !isValidIata(dest)) return ""

  var dep = safeText(o.departDate, 10)
  if (!isValidDate(dep)) return ""

  var cur = safeText(o.currency, 8).toUpperCase()
  if (!/^[A-Z]{3}$/.test(cur)) cur = "EUR"

  var q = origin + " to " + dest + ", departing " + dep
  var ret = safeText(o.returnDate, 10)
  if (isValidDate(ret)) q += ", returning " + ret
  else q += ", one way"
  q += ", " + Math.max(1, Math.min(9, parseInt(o.adults, 10) || 1)) + " adult"

  var url = API_ORIGIN + "/en?stage=results"
    + "&sid=" + encodeURIComponent(sid)
    + "&q=" + encodeURIComponent(q)
    + "&o=" + encodeURIComponent(origin)
    + "&d=" + encodeURIComponent(dest)
    + "&dep=" + encodeURIComponent(dep)
    + "&cur=" + encodeURIComponent(cur)
    + "&offer=" + encodeURIComponent(oid)

  // Last gate before a browser is handed the string.
  return safeHttpsUrl(url)
}

function resultsUrl(searchId) {
  // The search id comes back from the server and goes straight into a path.
  // Constrain it to the shape an id actually has so it cannot introduce a
  // path segment, a query string, or a second host.
  var id = String(searchId === null || searchId === undefined ? "" : searchId)
  if (!/^[A-Za-z0-9_\-]{1,120}$/.test(id)) throw new Error("bad search id")
  return apiUrl("/api/results/" + id)
}

// ---- Sign-in ---------------------------------------------------------------
//
// The whole point: getting a token should not require installing a Python CLI
// first. Same flow `letsfg auth` runs, driven from the panel:
//
//   1. POST /api/agent-access/request  -> 402 { setup_url, setup_session_id }
//   2. the person opens setup_url, adds a card (zero-amount Stripe setup,
//      nothing is charged)
//   3. POST /api/agent-access/verify   -> { token, expires_at }
//
// Step 2 is a browser, deliberately. A desktop plugin must never ask for card
// details itself, and Stripe's hosted page is the only correct place for them.
function agentRequestUrl() { return apiUrl("/api/agent-access/request") }
function agentVerifyUrl() { return apiUrl("/api/agent-access/verify") }

// The 402 IS the success case here -- it means "here is where to add a card",
// not "something went wrong".
function parseAgentRequest(text) {
  var out = { ok: false, setupUrl: "", sessionId: "", lifetimeDays: 0, error: "" }
  var parsed = parseJsonBody(text)
  if (!parsed.ok) { out.error = parsed.error; return out }
  var v = parsed.value

  // Only a Stripe checkout URL is ever opened. This link comes off the network
  // and goes straight to the browser, so the host is checked, not just the
  // scheme -- an open redirect here would be a phishing vector for card
  // details, which is the worst possible thing to get wrong.
  var url = safeHttpsUrl(v.setup_url)
  if (url.indexOf("https://checkout.stripe.com/") !== 0) {
    out.error = "letsfg.co returned an unexpected setup link; not opening it."
    return out
  }
  var sid = safeText(v.setup_session_id, 200)
  if (!/^cs_[A-Za-z0-9_]{6,190}$/.test(sid)) {
    out.error = "letsfg.co did not return a usable setup session."
    return out
  }

  out.ok = true
  out.setupUrl = url
  out.sessionId = sid
  var days = Number(v.token_lifetime_days)
  out.lifetimeDays = (isFinite(days) && days > 0 && days < 3650) ? Math.round(days) : 90
  return out
}

function parseAgentVerify(text, nowSec) {
  var out = { ok: false, token: "", expiresAt: 0, error: "" }
  var parsed = parseJsonBody(text)
  if (!parsed.ok) { out.error = parsed.error; return out }
  var v = parsed.value

  var token = safeText(v.token, 4096)
  // Same shape check the config parser applies: a token is an HTTP header
  // value, so anything outside printable ASCII could inject a header line.
  if (!/^[!-~]{8,4096}$/.test(token)) {
    out.error = safeText(v.error || v.message || "", 200)
    if (out.error.length === 0) out.error = "Verification did not return a token yet."
    return out
  }

  var exp = Number(v.expires_at)
  if (!isFinite(exp) || exp <= 0) exp = (Number(nowSec) || 0) + 90 * 86400
  // Some lanes report expiry in milliseconds; normalise so the panel and the
  // CLI agree on when a token dies.
  if (exp > 1e11) exp = exp / 1000

  out.ok = true
  out.token = token
  out.expiresAt = exp
  return out
}

// The exact file `letsfg auth` writes, so a token obtained here is readable by
// the CLI and vice versa.
function buildTokenConfig(token, expiresAt) {
  return JSON.stringify({ pfs_auth: { token: String(token), expires_at: Number(expiresAt) } })
}

// ---- Token -----------------------------------------------------------------

// Parse ~/.letsfg/config.json as written by `letsfg auth`:
//   { "pfs_auth": { "token": "...", "expires_at": <unix seconds> }, ... }
//
// Returns a redacted status plus the token. Callers hand the token straight to
// createSession and drop it; nothing else keeps it.
function parseTokenConfig(jsonText, nowSec) {
  var result = { state: "missing", token: "", expiresAt: 0, expiresInDays: 0 }
  if (typeof jsonText !== "string" || jsonText.length === 0) return result
  if (jsonText.length > MAX_RESPONSE_CHARS) { result.state = "malformed"; return result }

  var cfg
  try { cfg = JSON.parse(jsonText) } catch (e) { result.state = "malformed"; return result }
  if (!cfg || typeof cfg !== "object") { result.state = "malformed"; return result }

  var auth = cfg.pfs_auth
  if (!auth || typeof auth !== "object") return result
  if (typeof auth.token !== "string" || auth.token.length === 0) return result

  // A token is sent as an HTTP header value. Anything outside printable ASCII
  // could inject a header line, so a token that does not look like one is
  // treated as absent rather than sent.
  if (!/^[\x21-\x7e]{8,4096}$/.test(auth.token)) { result.state = "malformed"; return result }

  var expiresAt = Number(auth.expires_at)
  if (!isFinite(expiresAt) || expiresAt <= 0) expiresAt = 0

  result.token = auth.token
  result.expiresAt = expiresAt
  if (expiresAt > 0) {
    var now = Number(nowSec) || 0
    result.expiresInDays = Math.floor((expiresAt - now) / 86400)
    // Same 1h buffer the Python SDK uses, so "expired" means the same thing
    // in the panel as it does in the CLI.
    if (now >= expiresAt - TOKEN_EXPIRY_BUFFER_SEC) { result.state = "expired"; return result }
  }
  result.state = "ok"
  return result
}

// The token holder. The value is captured in this closure and there is no
// getter -- callers can apply it to a request or ask about it, and that is
// the whole surface. See invariant 2.
function createSession() {
  var token = ""
  var state = "missing"
  var expiresInDays = 0

  return {
    // Load from the parsed config. Returns the redacted status.
    adopt: function (parsed) {
      token = (parsed && parsed.state === "ok") ? String(parsed.token) : ""
      state = parsed ? String(parsed.state) : "missing"
      expiresInDays = parsed ? Number(parsed.expiresInDays) || 0 : 0
      return this.status()
    },
    forget: function () { token = ""; state = "missing"; expiresInDays = 0 },
    ready: function () { return token.length > 0 && state === "ok" },
    // Redacted on purpose: length, never content.
    status: function () {
      return { state: state, ready: token.length > 0 && state === "ok", expiresInDays: expiresInDays }
    },
    // The only way the token reaches a request. Refuses any URL that is not
    // on the pinned origin, so a caller cannot aim an authenticated request
    // somewhere else even by mistake.
    applyTo: function (xhr, url) {
      if (!token) throw new Error("no token")
      if (typeof url !== "string" || url.indexOf(API_ORIGIN + "/") !== 0)
        throw new Error("refusing to send credentials off-origin")
      xhr.setRequestHeader("Authorization", "Bearer " + token)
      return true
    }
  }
}

// Redact anything that looks like a credential before it is shown or logged.
// Errors are the classic place a token leaks: a stack trace, a URL echoed back
// in a message, a "failed request" line.
function redact(message) {
  var s = safeText(message, 400)
  s = s.replace(/[Bb]earer\s+[\x21-\x7e]+/g, "Bearer <redacted>")
  s = s.replace(/\b(letsfg|trav|tok)_[A-Za-z0-9_\-]{6,}/g, "$1_<redacted>")
  return s
}

// ---- Input validation ------------------------------------------------------
//
// Validation runs before a request is sent, not after it fails. A search costs
// LetsFG real money upstream, so a request that cannot possibly succeed must
// never leave the machine.

// Cap wide, then check -- see the note in buildSearchBody. Trimming to three
// characters here would turn "LISBON" into a valid-looking "LIS" and search a
// route the user did not ask for.
function normalizeIata(value) {
  return safeText(value, 32).toUpperCase().replace(/[^A-Z]/g, "")
}

function isValidIata(value) { return /^[A-Z]{3}$/.test(normalizeIata(value)) }

// A real calendar date in YYYY-MM-DD -- the round-trip through Date catches
// 2026-02-31 and 2026-13-01, which the regex alone does not.
function isValidDate(value) {
  var s = safeText(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  var y = parseInt(s.slice(0, 4), 10)
  var m = parseInt(s.slice(5, 7), 10)
  var d = parseInt(s.slice(8, 10), 10)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  var probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

function isValidCabin(value) {
  for (var i = 0; i < CABINS.length; i++) if (CABINS[i].code === value) return true
  return false
}

// Build the POST body, or explain exactly what is wrong. Returns
// { ok: true, body: {...} } or { ok: false, error: "..." }.
function buildSearchBody(form, todayIso) {
  var f = form || {}
  var origin = normalizeIata(f.origin)
  var destination = normalizeIata(f.destination)

  if (!isValidIata(origin)) return { ok: false, error: "From: needs a 3-letter IATA code, e.g. WAW" }
  if (!isValidIata(destination)) return { ok: false, error: "To: needs a 3-letter IATA code, e.g. LIS" }
  if (origin === destination) return { ok: false, error: "From and To are the same airport" }
  if (!isValidDate(f.departDate)) return { ok: false, error: "Depart: needs a date as YYYY-MM-DD" }

  var today = safeText(todayIso, 10)
  if (isValidDate(today) && f.departDate < today)
    return { ok: false, error: "Depart: that date is in the past" }

  var body = {
    origin: origin,
    destination: destination,
    date_from: f.departDate,
    adults: 1,
    currency: "EUR",
    // Ask the server for a bounded set rather than pulling hundreds of offers
    // across the wire and slicing locally.
    max_results: MAX_RENDERED_OFFERS
  }

  var ret = safeText(f.returnDate, 10)
  if (ret.length > 0) {
    if (!isValidDate(ret)) return { ok: false, error: "Return: needs a date as YYYY-MM-DD, or leave it empty" }
    if (ret < body.date_from) return { ok: false, error: "Return: is before the departure date" }
    body.return_from = ret
  }

  var adults = parseInt(f.adults, 10)
  if (!isFinite(adults) || adults < 1 || adults > 9) return { ok: false, error: "Adults: 1 to 9" }
  body.adults = adults

  // Validate at a generous cap, never at the field's own width. Sanitising to
  // the exact allowed length first would truncate "EURO" into a valid "EUR"
  // and "MX" into a valid "M" -- silently accepting bad input as good rather
  // than rejecting it. Cap wide, check, then use.
  var cabin = safeText(f.cabin, 16)
  if (cabin.length > 0) {
    if (!isValidCabin(cabin)) return { ok: false, error: "Cabin: not a known class" }
    body.cabin_class = cabin
  }

  var currency = safeText(f.currency, 16).toUpperCase()
  if (currency.length > 0) {
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "Currency: 3-letter code, e.g. EUR" }
    body.currency = currency
  }

  return { ok: true, body: body }
}

// ---- Response parsing ------------------------------------------------------

// Guarded parse. The Bearer lane answers some paths with an HTML 404 page, and
// JSON.parse on HTML throws a SyntaxError -- inside a shell process that is a
// crashed bar, not a failed request. Nothing here throws.
function parseJsonBody(text) {
  if (typeof text !== "string") return { ok: false, error: "Empty response from letsfg.co" }
  if (text.length === 0) return { ok: false, error: "Empty response from letsfg.co" }
  if (text.length > MAX_RESPONSE_CHARS) return { ok: false, error: "Response too large; ignored" }
  var trimmed = text.replace(/^\s+/, "")
  if (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")
    return { ok: false, error: "letsfg.co returned a non-JSON response" }
  var value
  try { value = JSON.parse(text) } catch (e) { return { ok: false, error: "Could not read the response from letsfg.co" } }
  if (!value || typeof value !== "object") return { ok: false, error: "Unexpected response shape" }
  return { ok: true, value: value }
}

// HTTP status -> a sentence a person can act on. A raw 401 reads as "broken
// plugin"; "your token expired, run letsfg auth" reads as what it is.
// True when the server is telling us the credential itself is dead -- revoked,
// expired, or rejected. The panel drops the session and shows verification
// again rather than leaving a dead token in place for the next search to
// fail on too.
function isAuthFailure(status, bodyText) {
  if (status === 401 || status === 403) return true
  var parsed = parseJsonBody(bodyText)
  if (!parsed.ok) return false
  var code = safeText(parsed.value.code, 40).toUpperCase()
  return code === "TOKEN_REVOKED" || code === "TOKEN_EXPIRED" || code === "NO_SESSION"
}

function describeHttpError(status, bodyText) {
  var parsed = parseJsonBody(bodyText)
  var detail = ""
  if (parsed.ok) {
    var v = parsed.value
    detail = safeText(v.detail || v.message || v.error || "", 200)
  }
  // A revoked or expired token is not a generic error: the only way out is
  // to verify again, so the message says that and the panel routes there.
  if (status === 401 || status === 403)
    return "Your verification is no longer valid. Verify identity again — Stripe charges $0."
  if (status === 402)
    return "Payment method needed. Run `letsfg auth` to put a card on file (nothing is charged)."
  if (status === 429)
    return "Rate limited by letsfg.co. " + (detail || "Wait a moment and try again.")
  if (status === 0)
    return "Could not reach letsfg.co. Check your connection."
  if (status >= 500)
    return "letsfg.co had a server error (" + status + "). Try again shortly."
  if (detail) return redact(detail)
  return "Request failed (HTTP " + status + ")."
}

// Rate-limit headers. The Bearer lane and the Developer API lane are limited by
// different machinery with different numbers, and the published docs disagree
// with each other -- so the panel reports what the server actually said on this
// response and never a compiled-in guess.
function parseRateLimit(getHeader) {
  var out = { limit: 0, remaining: -1, retryAfterMs: 0 }
  if (typeof getHeader !== "function") return out
  var limit = parseInt(safeText(getHeader("X-RateLimit-Limit"), 12), 10)
  var remaining = parseInt(safeText(getHeader("X-RateLimit-Remaining"), 12), 10)
  var retry = parseInt(safeText(getHeader("Retry-After"), 12), 10)
  if (isFinite(limit) && limit > 0) out.limit = limit
  if (isFinite(remaining) && remaining >= 0) out.remaining = remaining
  // Clamp: a hostile or broken Retry-After must not park the UI for a week.
  if (isFinite(retry) && retry > 0) out.retryAfterMs = Math.min(retry, 3600) * 1000
  return out
}

function parseSearchAck(text) {
  var parsed = parseJsonBody(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  var id = parsed.value.search_id
  if (typeof id !== "string" || !/^[A-Za-z0-9_\-]{1,120}$/.test(id))
    return { ok: false, error: "letsfg.co did not return a usable search id" }
  return { ok: true, searchId: id }
}

// The API reports work-in-progress as pending/searching; anything else is
// terminal. Treating unknown values as terminal is deliberate -- a status we do
// not recognise should stop the loop, not poll forever.
function isTerminalStatus(status) {
  var s = safeText(status, 32).toLowerCase()
  if (s.length === 0) return false
  return s !== "pending" && s !== "searching"
}

// Should we stop polling and show what we have? Pure decision, so the poll loop
// in QML holds no logic worth testing.
//
// state carries { lastCount, stablePolls } across calls and is returned updated.
// Merge a poll's offers into what we already have, keyed by offer id.
//
// letsfg.co accumulates across polls (`setOffers(prev => dedup([...prev, ...]))`)
// and the panel must too, because a later poll can legitimately return FEWER
// offers than an earlier one:
//
//   /api/results truncates what it writes to the durable cache when the payload
//   exceeds DURABLE_MAX_BYTES (880_000) -- it re-ranks, then drops 20% at a time
//   until it fits, stamping `offers_truncated` and `offers_stored` while
//   `total_results` keeps the TRUE count. The route's own note records live
//   measurements: 246 found / 108 stored, 235 / 132, 169 / 82.
//
// So once a search completes and the durable copy is what answers, the terminal
// poll can carry a fraction of the list. Replacing on every poll threw the rest
// away -- GDN->LAX showed 60 flights. Accumulating means a short poll can never
// shrink the set.
//
// Order does not matter here: the caller re-ranks the merged set, and ranking
// is a pure function of the offers plus the context.
function mergeOffers(existing, incoming) {
  var out = [], seen = {}, i, o, k
  function add(list) {
    if (!Array.isArray(list)) return
    for (i = 0; i < list.length; i++) {
      o = list[i]
      if (!o || typeof o !== "object") continue
      k = (typeof o.id === "string" && o.id.length > 0) ? o.id : null
      if (k === null) { out.push(o); continue }
      if (Object.prototype.hasOwnProperty.call(seen, k)) continue
      seen[k] = true
      out.push(o)
    }
  }
  add(existing)
  add(incoming)
  return out
}

function pollDecision(result, state) {
  var st = { lastCount: state && isFinite(state.lastCount) ? state.lastCount : -1,
             stablePolls: state && isFinite(state.stablePolls) ? state.stablePolls : 0,
             gracePolls: state && isFinite(state.gracePolls) ? state.gracePolls : 0 }
  var offers = (result && Array.isArray(result.offers)) ? result.offers : []

  // A terminal status ends the loop ONLY once nothing is still inbound.
  //
  // letsfg.co keeps polling past `completed` for as long as the worker says a
  // late merge is coming, on a 3s cadence with a ~120s ceiling:
  //
  //     const stillInbound = d?.gf_enrich_pending || d?.split_ticket_pending
  //     if (!stillInbound || graceLeft <= 0) return
  //     timer = setTimeout(poll, GRACE_POLL_MS)
  //
  // The panel stopped at `completed` and missed both. Observed GDN->MAD: the
  // panel settled on 93 offers, the site on 95 -- and the site's best result, a
  // EUR111 SAS with Starlink, arrived in that window and the panel never saw
  // it. Gate on the FLAG, not on the offer count settling: the count is flat
  // for the whole gap because the enrich lands as one lump 16-75s after
  // completion, so any "stopped growing" test returns long before it.
  //
  // This used to stop early two ways, and both were wrong:
  //
  //   "fast-group-done": offers >= 5 and 1-2 connectors still pending. On a real
  //   GDN->LIS search this fired on poll ONE and the panel showed 60 of the 256
  //   offers the site had. That is the bug Adam hit on 2026-08-23 -- "loads only
  //   60 flights and doesn't show the offers our website shows". Both halves are
  //   this: fewer offers, and a hero picked by ranking a truncated set.
  //
  //   "settled": 5 identical counts, i.e. 6 seconds without growth. Connectors
  //   land in waves and a mid-search plateau is completely normal, so this is a
  //   plateau detector that cannot wait out a plateau -- the same mistake that
  //   previously cost momondo 428->734 and cheapflights 200->482 offers.
  //
  // Stopping early is NOT what makes the panel feel fast: the caller assigns
  // root.offers on every poll, so results are already rendered progressively
  // while the search finishes. Ending the loop early does not paint anything
  // sooner, it only throws away the offers that had not arrived yet.
  //
  // MAX_POLLS still bounds the loop, so this cannot poll forever.
  if (isTerminalStatus(result ? result.status : "")) {
    var inbound = !!(result && (result.gf_enrich_pending || result.split_ticket_pending))
    st.gracePolls = (isFinite(st.gracePolls) ? st.gracePolls : 0) + 1
    if (!inbound || st.gracePolls >= GRACE_POLLS)
      return { done: true, reason: "complete", state: st }
    // Still terminal, but a merge is inbound -- keep going on the grace cadence.
    return { done: false, reason: "late-merge", state: st }
  }

  // Tracked for the caller's progress copy only -- never to end the loop.
  if (offers.length === st.lastCount) st.stablePolls = st.stablePolls + 1
  else st.stablePolls = 0
  st.lastCount = offers.length

  return { done: false, reason: "", state: st }
}

// ---- Offer view models -----------------------------------------------------

function pad2(n) { return (n < 10 ? "0" : "") + n }

// "2026-09-14T06:35:00" -> "06:35". Time only, computed from the string rather
// than a Date, so a missing timezone is not silently shifted.
function clockTime(value) {
  var s = safeText(value, 40)
  var m = s.match(/T(\d{2}):(\d{2})/)
  if (!m) return ""
  return m[1] + ":" + m[2]
}

function shortDate(value) {
  var s = safeText(value, 40)
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ""
  return m[3] + "/" + m[2]
}

// Whole days between two ISO timestamps, by date part only. A red-eye that
// lands after midnight shows "21:30-18:10" otherwise, which reads as a
// negative journey rather than a next-day arrival.
function dayOffset(fromIso, toIso) {
  var a = safeText(fromIso, 40).match(/^(\d{4})-(\d{2})-(\d{2})/)
  var b = safeText(toIso, 40).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!a || !b) return 0
  var ms = Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])
  var days = Math.round(ms / 86400000)
  return (isFinite(days) && days > 0 && days < 30) ? days : 0
}

var WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
var MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// "2026-09-06T21:30:00" -> "Sun, Sep 6", the same shape letsfg.co puts above a
// flight card. Built from the string parts rather than a parsed Date so a
// missing timezone cannot shift the day.
function dayLabel(value) {
  var m = safeText(value, 40).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ""
  var y = +m[1], mo = +m[2], d = +m[3]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return ""
  var probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return ""
  return WEEKDAY_SHORT[probe.getUTCDay()] + ", " + MONTH_SHORT[mo - 1] + " " + d
}

function formatDuration(minutes) {
  var n = Number(minutes)
  if (!isFinite(n) || n <= 0) return ""
  var h = Math.floor(n / 60)
  var m = Math.floor(n % 60)
  return h > 0 ? (h + "h " + pad2(m) + "m") : (m + "m")
}

function formatPrice(price, currency) {
  var n = Number(price)
  if (!isFinite(n) || n < 0) return ""
  var cur = safeText(currency, 3).toUpperCase()
  var rounded = Math.round(n * 100) / 100
  var shown = (rounded % 1 === 0) ? String(rounded) : rounded.toFixed(2)
  return cur ? (shown + " " + cur) : shown
}

function stopsLabel(stops) {
  var n = Number(stops)
  if (!isFinite(n) || n < 0) return ""
  if (n === 0) return "Nonstop"
  return n === 1 ? "1 stop" : (n + " stops")
}

// Turn API offers into exactly what the list renders.
//
// /api/search offers are FLAT: the journey summary is at the top level
// (origin / destination / departure_time / arrival_time / stops /
// duration_minutes), per-hop detail is in `segments`, and per-direction detail
// is in `trip_breakdown` entries tagged leg:"outbound"|"return". There is no
// `offer.outbound` wrapper and the carrier is singular `offer.airline`, not
// `offer.airlines`. Reading the shape the API does not return was issue #199
// in letsfg-mcp: every offer came back with a null journey and no airline.
function summarizeOffers(result, maxOffers) {
  var cap = (isFinite(maxOffers) && maxOffers > 0) ? Math.min(maxOffers, MAX_RENDERED_OFFERS) : MAX_RENDERED_OFFERS
  var raw = (result && Array.isArray(result.offers)) ? result.offers : []
  var out = []
  for (var i = 0; i < raw.length && out.length < cap; i++) {
    var o = raw[i]
    if (!o || typeof o !== "object") continue

    var legs = Array.isArray(o.trip_breakdown) ? o.trip_breakdown : []
    var segs = Array.isArray(o.segments) ? o.segments : []
    var ret = null
    for (var j = 0; j < legs.length; j++) {
      if (legs[j] && safeText(legs[j].leg, 16).toLowerCase() === "return") { ret = legs[j]; break }
    }

    var carriers = []
    var seen = {}
    var candidates = [o.airline]
    for (var k = 0; k < legs.length; k++) if (legs[k]) candidates.push(legs[k].airline)
    for (var s = 0; s < segs.length; s++) if (segs[s]) candidates.push(segs[s].airline)
    for (var c = 0; c < candidates.length; c++) {
      var name = safeText(candidates[c], 48)
      if (name.length > 0 && !seen[name]) { seen[name] = true; carriers.push(name) }
    }

    var stops = isFinite(Number(o.stops)) ? Number(o.stops) : Math.max(0, segs.length - 1)

    out.push({
      offerId: safeText(o.id || o.offer_ref, 120),
      price: money(o.price, o.currency),
      priceValue: isFinite(Number(o.price)) ? Number(o.price) : -1,
      currency: safeText(o.currency, 3).toUpperCase(),
      airline: carriers.length > 0 ? carriers[0] : "",
      // Only worth showing when a journey genuinely spans carriers.
      extraCarriers: carriers.length > 1 ? carriers.slice(1).join(", ") : "",
      route: safeText(o.origin, 8) + " -> " + safeText(o.destination, 8),
      origin: safeText(o.origin, 8),
      destination: safeText(o.destination, 8),
      originName: safeText(o.origin_name, 48),
      destinationName: safeText(o.destination_name, 48),
      flightNumber: safeText(o.flight_number, 16),
      aircraft: (segs.length > 0 && segs[0]) ? safeText(segs[0].aircraft, 40) : "",
      // Raw values, kept alongside the display strings so sorting and
      // filtering never has to parse a label back into a number.
      stopCount: isFinite(Number(o.stops)) ? Number(o.stops) : Math.max(0, segs.length - 1),
      durationMinutes: isFinite(Number(o.duration_minutes)) ? Number(o.duration_minutes) : -1,
      departHour: (function () {
        var t = clockTime(o.departure_time)
        return t.length === 5 ? parseInt(t.slice(0, 2), 10) : -1
      })(),
      bagLines: bagLines(o),
      // Rendered as the site renders them: a long connection called out on the
      // card, and the Starlink verdict as a chip.
      layover: layoverParts(o),
      starlink: starlinkChip(o),
      warning: warningFor(o),
      departDayLabel: dayLabel(o.departure_time),
      // Every carrier actually flown, each with its own logo + fallback.
      carriers: distinctCarriers(o),
      airlineCode: /^[A-Z0-9]{2}$/.test(safeText(o.airline_code, 8).toUpperCase())
        ? safeText(o.airline_code, 8).toUpperCase() : "",
      logoUrl: airlineLogoUrl(o.airline_code),
      bags: bagsFor(o),
      // letsfg.co prints "1 stop · FRA". The connecting airport is only
      // unambiguous on a single-stop hop, so anything else stays blank rather
      // than naming one of several.
      stopVia: (segs.length === 2 && segs[0] && segs[0].destination)
        ? safeText(segs[0].destination, 8) : "",
      departTime: clockTime(o.departure_time),
      departDate: shortDate(o.departure_time),
      arriveTime: clockTime(o.arrival_time),
      duration: formatDuration(o.duration_minutes),
      stops: stopsLabel(stops),
      arrivesNextDay: dayOffset(o.departure_time, o.arrival_time),
      // Virtual interlining: separate one-way fares stitched across airlines.
      isCombo: o.is_combo === true,
      returnDate: ret ? shortDate(ret.departure_time) : "",
      returnTime: ret ? clockTime(ret.departure_time) : "",
      returnAirline: ret ? safeText(ret.airline, 48) : "",
      // "" here means "no link we are willing to open", never "open something
      // else" -- the panel disables the row instead of guessing.
      bookingUrl: safeHttpsUrl(o.booking_url),
      // The API's own position. Sorting by price or duration must be able to
      // get back to the ranked order, and "best" IS that order.
      rank: out.length,
      // Filled in below.
      isCheapest: false
    })
  }

  // The API returns offers ranked by its own score -- 40% price, 30% duration,
  // 20% stops, 10% layover -- so the cheapest fare is usually NOT first, and a
  // list that opens with 152 EUR above a 140 EUR reads as broken. The order is
  // left exactly as received (the ranking is the product; recomputing it here
  // would be a worse answer), and the cheapest is marked instead, which is
  // also the number the bar label shows.
  var best = -1
  for (var b = 0; b < out.length; b++) {
    if (out[b].priceValue < 0) continue
    if (best === -1 || out[b].priceValue < out[best].priceValue) best = b
  }
  if (best >= 0) out[best].isCheapest = true
  return out
}

// The bar label: the cheapest price in the set, or "" for the bare glyph.
function cheapestLabel(offers) {
  if (!Array.isArray(offers) || offers.length === 0) return ""
  var best = null
  for (var i = 0; i < offers.length; i++) {
    var o = offers[i]
    if (!o || !isFinite(o.priceValue) || o.priceValue < 0) continue
    if (best === null || o.priceValue < best.priceValue) best = o
  }
  return best ? safeText(best.price, 24) : ""
}


// ---- Airport search --------------------------------------------------------
//
// The picker resolves "gdan" to Gdansk (GDN) entirely locally. Two reasons it
// is not a network call: the Bearer lane has no place-lookup endpoint at all
// (asking it returns a 404 HTML page), and a request per keystroke would be
// the wrong shape even if one existed.
//
// assets/airports.json is distilled from the site's own tables by
// tools/build-airports.py, so the plugin and the website agree on names rather
// than keeping two copies that drift.

var AIRPORTS = []
var AIRPORT_BY_CODE = {}

// Called once from QML after the bundled dataset is read.
function loadAirports(jsonText) {
  AIRPORTS = []
  AIRPORT_BY_CODE = {}
  var parsed = parseJsonBody(jsonText)
  if (!parsed.ok || !Array.isArray(parsed.value)) return 0
  for (var i = 0; i < parsed.value.length; i++) {
    var a = parsed.value[i]
    if (!a || typeof a.c !== "string" || !/^[A-Z0-9]{3}$/.test(a.c)) continue
    var entry = {
      code: a.c, name: String(a.n || ""), country: String(a.y || ""), isCity: a.city === 1,
      // `u` = flyable (present in OurAirports, which is exactly how the site
      // computes USABLE_IATAS), `cur` = one of the curated majors, `p` =
      // real but private/business-aviation.
      usable: a.u === 1, curated: a.cur === 1, privateAv: a.p === 1
    }
    if (typeof a.lat === "number" && typeof a.lon === "number") {
      entry.lat = a.lat
      entry.lon = a.lon
    }
    entry.terms = foldForSearch(entry.name)
    AIRPORTS.push(entry)
    AIRPORT_BY_CODE[entry.code] = entry
  }
  return AIRPORTS.length
}

// ---- Anonymous install id --------------------------------------------------
//
// One random id per installation, generated on first run and stored beside the
// token. It is what makes "how many people use the panel" answerable at all --
// searches alone cannot tell one person searching ten times from ten people.
//
// It is NOT identity: no account, no device fingerprint, nothing derived from
// the machine. A fresh install is a fresh id, and deleting the state file
// forgets it. It rides on X-LetsFG-Install and only ever labels analytics.
function newInstallId() {
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  var out = ""
  for (var i = 0; i < 24; i++) out += chars.charAt(Math.floor(Math.random() * chars.length))
  return out
}

function isValidInstallId(value) {
  var v = safeText(value, 64)
  return /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : ""
}

function airportCount() { return AIRPORTS.length }

// The website's curated name-collision map (NEARBY_AIRPORTS), consulted ONLY
// when nothing flyable matched. It is what stops "jordan" offering JDN, a strip
// in Jordan, Montana, instead of Amman -- and "the hague", "pretoria" and 42
// others like them, none of which have an airport of their own.
var NAME_FALLBACKS = {}

function loadNameFallbacks(jsonText) {
  NAME_FALLBACKS = {}
  var parsed = parseJsonBody(jsonText)
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return 0
  var n = 0
  for (var k in parsed.value) {
    if (!Object.prototype.hasOwnProperty.call(parsed.value, k)) continue
    var code = parsed.value[k]
    if (typeof code === "string" && /^[A-Z0-9]{3}$/.test(code)) { NAME_FALLBACKS[k] = code; n++ }
  }
  return n
}

function nameFallback(query) {
  var q = foldForSearch(query)
  var code = Object.prototype.hasOwnProperty.call(NAME_FALLBACKS, q) ? NAME_FALLBACKS[q] : ""
  return code && AIRPORT_BY_CODE[code] ? AIRPORT_BY_CODE[code] : null
}

// Fold diacritics so "gdansk" finds "Gdansk" and "koln" finds "Koln". Written
// out rather than using String.normalize, which QML's engine does not
// reliably provide.
var FOLD_FROM = "àáâãäåąèéêëęìíîïòóôõöøóùúûüýÿçćñńśźżłřšžčěæ"
var FOLD_TO = "aaaaaaaeeeeeiiiiooooooouuuuyyccnnszzlrszcea"

function foldForSearch(value) {
  var s = safeText(value, 80).toLowerCase()
  var out = ""
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i)
    var idx = FOLD_FROM.indexOf(ch)
    if (idx >= 0) { out += FOLD_TO.charAt(idx); continue }
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === " ") { out += ch; continue }
    out += " "
  }
  return out.replace(/\s+/g, " ").trim()
}

// Scored the way the site scores: an exact code beats a code prefix, which
// beats a name prefix, which beats a name substring. Multi-airport metros are
// nudged up so "london" offers LON above LHR -- searching the metro is usually
// what someone means, and it is the feature that makes LetsFG worth using.
function searchAirports(query, limit) {
  var q = foldForSearch(query)
  var cap = (isFinite(limit) && limit > 0) ? limit : 6
  if (q.length < 2) return []

  var scored = []
  for (var i = 0; i < AIRPORTS.length; i++) {
    var a = AIRPORTS[i]
    var code = a.code.toLowerCase()
    var codeMatch = code === q
    var codeStarts = code.indexOf(q) === 0
    var score = 0
    if (codeMatch) score += 120
    else if (codeStarts) score += 100
    if (a.terms.indexOf(q) === 0) score += 50
    else if (a.terms.indexOf(" " + q) > 0) score += 34   // matches a later word
    else if (a.terms.indexOf(q) > 0) score += 20
    if (score === 0) continue
    if (a.isCity) score += 30
    // The website's importance bonus, and the reason a major beats an obscure
    // same-name match: CURATED_AIRPORT_CODES gets +30 there, so it does here.
    if (a.curated) score += 30
    // Shorter names first when scores tie: "Milan" over "Milan Bergamo".
    score -= Math.min(9, a.name.length / 6)

    // Whether you can actually fly from it. A name-only match on an airport
    // with no scheduled service is what the site calls a ghost: typing
    // "Stuttgart" offered SGT (a strip in Arkansas) ABOVE Stuttgart STR, and
    // picking it 400s the search server-side. Someone who types the CODE still
    // finds it.
    var usable = codeMatch || codeStarts || a.usable
    scored.push({ a: a, s: score, usable: usable, priv: !usable && a.privateAv })
  }

  scored.sort(function (x, y) { return y.s - x.s || (x.a.code < y.a.code ? -1 : 1) })

  // Nothing flyable matched: consult the curated name-collision map before
  // offering a ghost. "jordan" means Amman, not a Montana airstrip.
  var anyUsable = false
  for (var k = 0; k < scored.length; k++) if (scored[k].usable) { anyUsable = true; break }
  if (!anyUsable) {
    var fb = nameFallback(query)
    if (fb) {
      var rest = []
      for (var m = 0; m < scored.length; m++) if (scored[m].a.code !== fb.code) rest.push(scored[m])
      scored = [{ a: fb, s: 1000, usable: true, priv: false }].concat(rest)
    }
  }

  // Usable first, then private aviation demoted to the bottom -- visible, not
  // hidden, exactly as the site orders them. Ghosts only surface if nothing
  // else matched at all, so the dropdown is never silently empty.
  var out = [], j, e
  for (j = 0; j < scored.length && out.length < cap; j++) {
    if (!scored[j].usable) continue
    e = scored[j].a
    out.push({ code: e.code, name: e.name, country: e.country, isCity: e.isCity })
  }
  for (j = 0; j < scored.length && out.length < cap; j++) {
    if (!scored[j].priv) continue
    e = scored[j].a
    out.push({ code: e.code, name: e.name, country: e.country, isCity: e.isCity })
  }
  // Ghosts ONLY when nothing else matched at all -- never alongside a real
  // airport. This is the difference between offering "Stuttgart SGT (US)" and
  // not: SGT has no scheduled service, so /api/search answers a search built on
  // it with 400 "Could not determine origin or destination." Listing it beside
  // Stuttgart STR is how a person ends up picking the one that cannot fly.
  if (out.length === 0) {
    for (j = 0; j < scored.length && out.length < cap; j++) {
      e = scored[j].a
      out.push({ code: e.code, name: e.name, country: e.country, isCity: e.isCity })
    }
  }
  return out
}

// The name to show for a code the user typed directly, so "GDN" still renders
// as "Gdansk (GDN)" before any search has run.
function airportCountry(code) {
  var c = safeText(code, 8).toUpperCase()
  var e = AIRPORT_BY_CODE[c]
  return e ? e.country : ""
}

function airportName(code) {
  var c = safeText(code, 8).toUpperCase()
  var e = AIRPORT_BY_CODE[c]
  return e ? e.name : ""
}

// Where an airport is, for the results map. Returns null when the table has no
// fix for that code -- the map then simply does not appear.
function airportCoord(code) {
  var c = safeText(code, 8).toUpperCase()
  var e = AIRPORT_BY_CODE[c]
  if (!e || typeof e.lat !== "number" || typeof e.lon !== "number") return null
  return { lat: e.lat, lon: e.lon }
}

// ---- Map tiles -------------------------------------------------------------
//
// A slippy map assembled from raster tiles in plain QML. The site uses MapLibre
// with vector tiles, which needs a renderer QML does not have; QtLocation could
// draw one but is a separate package the shell's Qt may not ship, and a missing
// optional module shows up as a blank rectangle on someone else's desktop.
// Tiles are just images, so this needs nothing beyond QtQuick.
//
// CARTO rather than tile.openstreetmap.org: OSM's tile policy asks every client
// to send an identifying User-Agent, and Qt's Image element cannot set one, so
// using it would mean quietly breaking their terms. CARTO's basemap CDN is
// built for application use. Attribution is required and is drawn on the map.
var TILE_HOST = "https://basemaps.cartocdn.com/rastertiles/voyager/"
var TILE_SIZE = 256
var TILE_ATTRIBUTION = "© OpenStreetMap contributors © CARTO"

function tileUrl(z, x, y) {
  if (!isFinite(z) || !isFinite(x) || !isFinite(y)) return ""
  var zi = Math.floor(z), xi = Math.floor(x), yi = Math.floor(y)
  if (zi < 0 || zi > 19) return ""
  var n = Math.pow(2, zi)
  if (yi < 0 || yi >= n) return ""
  // Longitude wraps; latitude does not.
  xi = ((xi % n) + n) % n
  var url = TILE_HOST + zi + "/" + xi + "/" + yi + ".png"
  return url.indexOf(TILE_HOST) === 0 ? url : ""
}

function lonToTileX(lon, z) {
  return (Number(lon) + 180) / 360 * Math.pow(2, z)
}

function latToTileY(lat, z) {
  var rad = Number(lat) * Math.PI / 180
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z)
}

// The tiles covering a viewW x viewH viewport centred on lat/lon, each with the
// pixel offset it should be drawn at, plus where the centre lands.
function tileGrid(lat, lon, z, viewW, viewH) {
  var out = { tiles: [], centerX: viewW / 2, centerY: viewH / 2, z: z }
  if (!isFinite(lat) || !isFinite(lon) || !isFinite(viewW) || !isFinite(viewH)) return out
  if (viewW <= 0 || viewH <= 0) return out

  var n = Math.pow(2, z)
  var cx = lonToTileX(lon, z) * TILE_SIZE
  var cy = latToTileY(lat, z) * TILE_SIZE
  var left = cx - viewW / 2
  var top = cy - viewH / 2

  var x0 = Math.floor(left / TILE_SIZE), x1 = Math.floor((left + viewW) / TILE_SIZE)
  var y0 = Math.floor(top / TILE_SIZE), y1 = Math.floor((top + viewH) / TILE_SIZE)

  for (var ty = y0; ty <= y1; ty++) {
    if (ty < 0 || ty >= n) continue          // no tiles past the poles
    for (var tx = x0; tx <= x1; tx++) {
      var url = tileUrl(z, tx, ty)
      if (url.length === 0) continue
      out.tiles.push({
        url: url,
        px: tx * TILE_SIZE - left,
        py: ty * TILE_SIZE - top
      })
    }
  }
  return out
}

// Any other point's position inside that same viewport, so a second marker can
// be placed without recomputing the grid.
function projectInto(lat, lon, centerLat, centerLon, z, viewW, viewH) {
  var cx = lonToTileX(centerLon, z) * TILE_SIZE
  var cy = latToTileY(centerLat, z) * TILE_SIZE
  var px = lonToTileX(lon, z) * TILE_SIZE
  var py = latToTileY(lat, z) * TILE_SIZE
  return { x: px - (cx - viewW / 2), y: py - (cy - viewH / 2) }
}

// ---- Ground transport ------------------------------------------------------
//
// POST /api/transfers/airport returns real rideshare/transfer estimates from an
// arrival airport to the city centre. The site draws the cheapest as a pill on
// the map ("WAW $43.34 - 20m to city center"), and so does this.
//
// The route is a website proxy that holds the server-side key, and it checks
// Origin only when one is present -- a desktop client sends none, so it is
// callable directly. It fails soft by design (offers: [] on any backend
// problem), and so does this: no offers means no pill.
function parseTransfers(text) {
  var out = { ok: false, price: "", minutes: 0, provider: "" }
  var parsed = parseJsonBody(text)
  if (!parsed.ok) return out
  var offers = parsed.value.offers
  if (!Array.isArray(offers) || offers.length === 0) return out

  var best = null
  for (var i = 0; i < offers.length; i++) {
    var o = offers[i]
    if (!o || typeof o !== "object") continue
    var p = Number(o.price)
    if (!isFinite(p) || p < 0) continue
    if (best === null || p < Number(best.price)) best = o
  }
  if (best === null) return out

  out.ok = true
  out.price = money(best.price, best.currency)
  var mins = Number(best.duration_minutes)
  out.minutes = (isFinite(mins) && mins > 0 && mins < 1440) ? Math.round(mins) : 0
  out.provider = safeText(best.provider_name, 60)
  return out
}

// ---- Presentation helpers matching letsfg.co ------------------------------

// The site writes money with a symbol in front -- "$48", "€97" -- not a
// trailing code.
var CURRENCY_SYMBOL = { USD: "$", EUR: "\u20ac", GBP: "\u00a3", PLN: "z\u0142", CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr" }

function money(amount, currency) {
  var n = Number(amount)
  if (!isFinite(n) || n < 0) return ""
  var cur = safeText(currency, 3).toUpperCase()
  var rounded = Math.round(n * 100) / 100
  var shown = (rounded % 1 === 0) ? String(rounded) : rounded.toFixed(2)
  var sym = CURRENCY_SYMBOL[cur]
  if (!sym) return cur ? (shown + " " + cur) : shown
  // "zl" reads better after the number, the way Polish writes it.
  return (cur === "PLN") ? (shown + " " + sym) : (sym + shown)
}

// "Gdansk (GDN)". The results payload sometimes repeats the bare code as the
// name (parsed.origin_name === "GDN"), which would render "GDN (GDN)" -- so a
// name equal to the code collapses back to just the code.
function placeLabel(name, code) {
  var c = safeText(code, 8).toUpperCase()
  var n = safeText(name, 48)
  if (n.length === 0 || n.toUpperCase() === c) return c
  return c.length > 0 ? (n + " (" + c + ")") : n
}

// "2026-09-21" -> "Sep 21", the way the collapsed search bar shows it.
function shortDayLabel(value) {
  var m = safeText(value, 40).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ""
  var mo = +m[2], d = +m[3]
  if (mo < 1 || mo > 12) return ""
  return MONTH_SHORT[mo - 1] + " " + d
}

function travelerLabel(n) {
  var c = Math.max(1, Math.min(9, parseInt(n, 10) || 1))
  return c + (c === 1 ? " traveler" : " travelers")
}

// NO CLIENT-SIDE MARKUP HERE. The panel's offers arrive ALREADY marked up.
//
// /api/results applies applyOfferMarkup server-side for agent-rail requests
// (withAgentPricing, gated on the middleware-stamped x-lfg-agent-rail, whose
// values are card | mpp | x). A PFS bearer token rides the `card` rail, so the
// panel is on it. Measured on the same search id, 2026-08-24:
//
//     anonymous : 161.67  192.46  195.03      <- raw connector prices
//     bearer    : 167     198     201         <- round(x * 1.03), already applied
//
// letsfg.co's own page is the ANONYMOUS caller, which is why FlowResults
// rawToCard does `price: applyOfferMarkup(...)` -- it has to add what the
// server did not. Copying that here double-charged: 167 -> 172.
//
// I got this wrong once by checking an anonymous curl payload and concluding
// the panel under-quoted. Check the lane the panel actually uses.

// Baggage lines exactly as the site words them: included bags say so, and a
// paid bag shows what it costs rather than being hidden. A bag the source
// never mentioned produces no line at all -- silence beats a guess on a fare
// somebody is about to buy.
function bagLines(offer) {
  var out = []
  if (!offer || typeof offer !== "object") return out
  var a = offer.ancillaries
  if (!a || typeof a !== "object") return out

  // A bag PRICE is only shown when the payload says it was really looked up.
  // `ancillaries.price_source` is 'live' | 'mixed' | 'estimate' | 'unknown',
  // and estimate/unknown means a static per-airline guess rather than this
  // offer's actual fee -- letsfg.co gates on exactly this
  // (FlowResults.rawToCard: bagsConfirmed), because showing a guess with the
  // same confidence as a real price is the failure the feature exists to
  // prevent. The panel had no gate: in a real 256-offer payload the split was
  // 222 estimate / 33 mixed / 1 unknown, so ~87% of the prices it printed were
  // guesses presented as fact, on a fare someone is about to buy.
  //
  // included/not-included is still shown for every offer -- that part is not a
  // guess, only the number is.
  var priced = a.price_source === "live" || a.price_source === "mixed"

  function line(block, noun) {
    if (!block || typeof block !== "object") return
    if (block.included === true) { out.push({ text: noun + " included", included: true }); return }
    if (block.included === false) {
      // The bag fee is NOT converted, and it is labelled with its OWN currency.
      // These really do arrive in a different currency from the fare -- in that
      // same payload every one of the 20 confirmed fees was USD against a EUR
      // fare. letsfg.co formats this number with the DISPLAY currency instead
      // (money(c.checkedPrice, currency)), which prints a $122.84 fee as
      // EUR122.84. That is a site bug, so it is deliberately not copied here:
      // a wrong symbol on a real price is worse than an unfamiliar one.
      var price = priced ? money(block.price, block.currency) : ""
      out.push({ text: price ? (noun + " +" + price) : (noun + " not included"), included: false })
    }
  }
  // Checked first, matching the order on the site's cards.
  line(a.checked_bag, "Checked bag")
  line(a.cabin_bag, "Cabin bag")
  return out
}

// The amber caution on a card. Only things the payload actually states: a long
// airport connection, or a self-transfer the traveller has to make themselves.
// The longest gap between consecutive segments, and where it happens.
// Mirrors legLongestLayover() in FlowResults.tsx.
function longestLayover(offer) {
  var best = { minutes: 0, airport: "" }
  if (!offer || typeof offer !== "object") return best
  var legs = [offer.segments]
  if (offer.inbound && Array.isArray(offer.inbound.segments)) legs.push(offer.inbound.segments)
  for (var L = 0; L < legs.length; L++) {
    var segs = legs[L]
    if (!Array.isArray(segs)) continue
    for (var i = 0; i < segs.length - 1; i++) {
      var a = segs[i], b = segs[i + 1]
      if (!a || !b) continue
      var gap = minutesBetweenIso(a.arrival_time, b.departure_time)
      if (gap > best.minutes) { best = { minutes: gap, airport: safeText(a.destination, 8).toUpperCase() } }
    }
  }
  return best
}

// Minutes between two ISO timestamps, computed from the strings so a missing
// timezone is not silently shifted -- the same reason clockTime() does.
function minutesBetweenIso(fromIso, toIso) {
  var a = isoToMinutes(fromIso), b = isoToMinutes(toIso)
  if (a === null || b === null) return 0
  var d = b - a
  return d > 0 ? d : 0
}

function isoToMinutes(value) {
  var s = safeText(value, 40)
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000
}

// "8h 25m layover in Copenhagen (CPH)" -- the site's own wording, shown at the
// same threshold it uses (LAYOVER_PRESETS[0] = 6 hours). Below that a
// connection is unremarkable and the site says nothing.
var LAYOVER_HINT_MINUTES = 6 * 60

// Returns the PARTS, not a finished string. The airport table is filled by a
// FileView asynchronously, so formatting here can run before it exists and bake
// in a bare code -- "8h 25m layover in WAW" instead of "... in Warsaw (WAW)".
// The card formats it in a binding that also reads airportsLoaded, so the label
// completes itself the moment the table lands. (Same trap as the results map's
// mapCoord, which is why that binding names airportsLoaded too.)
function layoverParts(offer) {
  var l = longestLayover(offer)
  if (l.minutes < LAYOVER_HINT_MINUTES || !l.airport) return null
  return { minutes: l.minutes, airport: l.airport }
}

// "8h 25m layover in Warsaw (WAW)" -- the site's wording, via airportLabel().
function layoverLabel(parts) {
  if (!parts || !parts.airport) return ""
  var name = airportName(parts.airport)
  var place = name ? (name + " (" + parts.airport + ")") : parts.airport
  return formatDuration(parts.minutes) + " layover in " + place
}

// The offer-level Starlink verdict, worded exactly as the site words it.
// `starlink` is one of confirmed_all | confirmed_some | likely_all | likely_some.
function starlinkChip(offer) {
  var v = safeText(offer && offer.starlink, 24)
  if (!v) return null
  var confirmed = v.indexOf("confirmed") === 0
  var some = /_some$/.test(v)
  if (!confirmed && v.indexOf("likely") !== 0) return null
  return {
    label: confirmed
      ? (some ? "Starlink · some" : "Starlink")
      : (some ? "Starlink likely · some" : "Starlink likely"),
    confirmed: confirmed
  }
}

function warningFor(offer) {
  if (!offer || typeof offer !== "object") return ""
  var c = offer.conditions
  if (!c || typeof c !== "object") return ""
  // `conditions.long_layover` is deliberately NOT used here any more: the card
  // now renders the site's own layover line ("8h 25m layover in Copenhagen
  // (CPH)"), computed from the segments, and carrying a second differently
  // worded copy in the warning slot said the same thing twice in two voices.
  var self = safeText(c.self_transfer, 40).toLowerCase()
  if (self.length > 0 && self !== "protected") return "Self-transfer — you re-check yourself"
  return ""
}

// ---- Currency --------------------------------------------------------------

var CURRENCIES = [
  { key: "EUR", label: "EUR  €" }, { key: "USD", label: "USD  $" },
  { key: "GBP", label: "GBP  £" }, { key: "PLN", label: "PLN  zł" },
  { key: "CHF", label: "CHF" }, { key: "SEK", label: "SEK  kr" },
  { key: "NOK", label: "NOK  kr" }, { key: "DKK", label: "DKK  kr" }
]

function isValidCurrency(code) {
  var c = safeText(code, 8).toUpperCase()
  for (var i = 0; i < CURRENCIES.length; i++) if (CURRENCIES[i].key === c) return true
  return false
}


// ---- Hotels ----------------------------------------------------------------
//
// Hotels run on the SAME credential as flights. The plugin previously claimed
// they needed a separate Developer API key; that was wrong, and the repo says
// so plainly: "Hotels work on the same credential. They accept either the PFS
// token from `letsfg auth` or a Developer API key, and need a card on file --
// which `letsfg auth` already puts there."
//
// The path is /developers/api/v1/hotels/*, but the header is the same Bearer
// token, exactly as sdk/mcp sends it.
//
// Two calls: resolve a city to an id, then search it. Search opens a real
// session at the supplier and takes the better part of a minute, so it gets a
// long deadline and the same click-only rule flights have.
function hotelDestinationsUrl() { return apiUrl("/developers/api/v1/hotels/destinations") }
function hotelSearchUrl() { return apiUrl("/developers/api/v1/hotels/search") }

// A hotel search is slower than a flight search and opens a supplier session.
var HOTEL_TIMEOUT_MS = 180000

// Hotel photography comes from the suppliers' own CDNs. Allowlisted rather
// than followed blindly, same as the destination cards.
var HOTEL_IMAGE_HOSTS = [
  "https://i.travelapi.com/",
  "https://q-xx.bstatic.com/",
  "https://letsfg.co/"
]

function allowedHotelImage(url) {
  var u = safeHttpsUrl(url)
  if (u.length === 0) return ""
  for (var i = 0; i < HOTEL_IMAGE_HOSTS.length; i++)
    if (u.indexOf(HOTEL_IMAGE_HOSTS[i]) === 0) return u
  return ""
}

// /hotels/destinations answers { results: [{ Name, Id, Type, Rank, CountryCode }] }.
// Type 1 is a place; anything else (a specific property) is not what the city
// picker is for. Ranked by Rank so "Warsaw" offers Poland before Indiana.
function parseHotelDestinations(text, limit) {
  var cap = (isFinite(limit) && limit > 0) ? limit : 6
  var parsed = parseJsonBody(text)
  if (!parsed.ok) return []
  var rows = parsed.value.results
  if (!Array.isArray(rows)) return []

  var out = []
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]
    if (!r || typeof r !== "object") continue
    if (Number(r.Type) !== 1) continue
    var id = Number(r.Id)
    if (!isFinite(id) || id <= 0) continue
    var name = safeText(r.Name, 80)
    if (name.length === 0) continue
    out.push({ id: id, name: name, country: safeText(r.CountryCode, 2), rank: Number(r.Rank) || 0 })
  }
  out.sort(function (a, b) { return b.rank - a.rank })
  return out.slice(0, cap)
}

function buildHotelSearchBody(form) {
  var f = form || {}
  var cityId = Number(f.cityId)
  if (!isFinite(cityId) || cityId <= 0) return { ok: false, error: "Pick a city from the list first" }
  var cityName = safeText(f.cityName, 80)
  if (cityName.length === 0) return { ok: false, error: "Pick a city from the list first" }
  if (!isValidDate(f.checkIn)) return { ok: false, error: "Check-in: needs a date" }
  if (!isValidDate(f.checkOut)) return { ok: false, error: "Check-out: needs a date" }
  if (f.checkOut <= f.checkIn) return { ok: false, error: "Check-out must be after check-in" }

  var adults = parseInt(f.adults, 10)
  if (!isFinite(adults) || adults < 1 || adults > 9) return { ok: false, error: "Guests: 1 to 9" }

  return {
    ok: true,
    body: {
      city_id: cityId,
      city_name: cityName,
      check_in: f.checkIn,
      check_out: f.checkOut,
      adults: adults,
      limit: 20
    }
  }
}

// Nights between two ISO dates, for the per-night figure.
function nightsBetween(checkIn, checkOut) {
  if (!isValidDate(checkIn) || !isValidDate(checkOut)) return 0
  var a = new Date(Date.UTC(+checkIn.slice(0, 4), +checkIn.slice(5, 7) - 1, +checkIn.slice(8, 10)))
  var b = new Date(Date.UTC(+checkOut.slice(0, 4), +checkOut.slice(5, 7) - 1, +checkOut.slice(8, 10)))
  var n = Math.round((b - a) / 86400000)
  return (n > 0 && n < 400) ? n : 0
}

// Only free-cancellation, pay-later rates come back, so every card shown can
// actually be booked on those terms. `price` is what the guest pays in total;
// `reservation_fee_now` is the slice taken at booking.
function summarizeHotels(result, nights, maxHotels) {
  var cap = (isFinite(maxHotels) && maxHotels > 0) ? maxHotels : 20
  var rows = (result && Array.isArray(result.hotels)) ? result.hotels : []
  var out = []

  for (var i = 0; i < rows.length && out.length < cap; i++) {
    var h = rows[i]
    if (!h || typeof h !== "object") continue

    var offers = Array.isArray(h.offers) ? h.offers : []
    var best = null
    for (var j = 0; j < offers.length; j++) {
      var o = offers[j]
      if (!o || typeof o !== "object") continue
      var p = Number(o.price)
      if (!isFinite(p) || p < 0) continue
      if (best === null || p < Number(best.price)) best = o
    }
    if (best === null) continue

    var images = Array.isArray(h.images) ? h.images : []
    var image = ""
    for (var k = 0; k < images.length && image.length === 0; k++) image = allowedHotelImage(images[k])

    var stars = Number(h.stars)
    var reviews = Number(h.review_count)
    var total = Number(best.price)
    var perNight = (nights > 0) ? (total / nights) : 0

    out.push({
      name: safeText(h.name, 70),
      stars: (isFinite(stars) && stars >= 1 && stars <= 5) ? Math.round(stars) : 0,
      address: safeText(h.address, 80).replace(/,\s*$/, ""),
      city: safeText(h.city, 40),
      rating: safeText(h.guest_rating, 24),
      reviews: (isFinite(reviews) && reviews > 0) ? reviews : 0,
      image: image,
      room: safeText(best.room, 60),
      board: safeText(best.board, 40),
      freeCancellation: safeText(best.cancellation_policy, 40).toLowerCase().indexOf("free") === 0,
      price: money(total, best.currency),
      priceValue: total,
      perNight: perNight > 0 ? money(perNight, best.currency) : "",
      dueNow: money(best.reservation_fee_now, best.currency)
    })
  }

  // Cheapest first: there is no server-side ranking to preserve here, unlike
  // flights, where the API's own order IS the product.
  out.sort(function (a, b) { return a.priceValue - b.priceValue })
  return out
}

// ---- Popular destinations --------------------------------------------------
//
// The site ranks these from a live analytics rollup and falls back to a
// curated six when that is unavailable. The plugin ships the curated set:
// it is the same CURATED_DEFAULT_ORDER the site uses as its floor, the images
// are the site's own, and it means the home view has real content without a
// request or a dependency on an admin-keyed endpoint.
var POPULAR = [
  { code: "TYO", city: "Tokyo", country: "Japan" },
  { code: "BCN", city: "Barcelona", country: "Spain" },
  { code: "NYC", city: "New York", country: "United States" },
  { code: "PAR", city: "Paris", country: "France" },
  { code: "DPS", city: "Bali", country: "Indonesia" },
  { code: "DXB", city: "Dubai", country: "UAE" }
]

// The REAL "Popular right now" ranking. The site computes it from a live
// analytics rollup of the last 7 days of searches; that endpoint needs an admin
// key and its public replacement is not deployed yet, so the ranking is lifted
// from letsfg.co's own homepage, which server-renders these cards.
//
// The bundled six stay as the floor for when the page cannot be read -- the
// same fallback the site itself uses.
//
// Card images live on the hosts the site's image resolver picks. Those are
// allowlisted rather than followed blindly: an <img> URL taken from parsed
// markup is exactly the kind of string that should not be able to point
// anywhere it likes.
var POPULAR_IMAGE_HOSTS = [
  "https://images.pexels.com/",
  "https://upload.wikimedia.org/",
  "https://letsfg.co/"
]

function allowedPopularImage(url) {
  var raw = safeText(url, 600)
  // Curated cards point at a site-relative path (/destinations/bali.jpg), which
  // is not a URL yet -- resolve it against the pinned origin before checking.
  if (raw.indexOf("/") === 0 && raw.indexOf("//") !== 0) {
    // No traversal: it would still land on our own origin, but resolving
    // "/../../x" into a URL at all is the wrong shape to hand an Image.
    if (raw.indexOf("..") !== -1) return ""
    try { raw = apiUrl(raw) } catch (e) { return "" }
  }
  var u = safeHttpsUrl(raw)
  if (u.length === 0) return ""
  for (var i = 0; i < POPULAR_IMAGE_HOSTS.length; i++)
    if (u.indexOf(POPULAR_IMAGE_HOSTS[i]) === 0) return u
  return ""
}

function parsePopularFromHtml(html, limit) {
  var cap = (isFinite(limit) && limit > 0) ? limit : 8
  var s = typeof html === "string" ? html : ""
  if (s.length === 0 || s.length > MAX_RESPONSE_CHARS) return []
  var start = s.indexOf("lp-pop-track")
  if (start < 0) return []
  var region = s.slice(start, start + 30000)

  var out = []
  var seen = {}
  // Each card is <a class="lp-pop-card" ...><img src="..."> ... city ... code.
  var cardRe = /lp-pop-card[\s\S]{0,900}?lp-pop-code[^>]*>([A-Z]{3})</g
  var m
  while ((m = cardRe.exec(region)) !== null && out.length < cap) {
    var code = m[1]
    if (seen[code]) continue
    seen[code] = true
    var block = m[0]
    var cityM = block.match(/lp-pop-city[^>]*>([^<]{1,60})</)
    var imgM = block.match(/<img[^>]+src="([^"]{1,600})"/)
    var city = cityM ? safeText(decodeEntities(cityM[1]), 48) : airportName(code)
    if (city.length === 0) city = code
    out.push({
      code: code,
      city: city,
      image: imgM ? allowedPopularImage(decodeEntities(imgM[1])) : ""
    })
  }
  return out
}

// The homepage is HTML, so &amp; and friends arrive escaped. Only the handful
// that actually appear in these attributes -- this is not a general parser.
function decodeEntities(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

// ---- Social proof ----------------------------------------------------------
//
// letsfg.co serves the star count as an SVG badge (/api/stars/badge) and, once
// tools/website-stars-endpoint.ts is deployed, as JSON at /api/stars/social.
// Prefer the JSON; fall back to reading the badge's own aria-label, which is
// the human-facing string and therefore the stable part of that document.
//
// Either way a failure yields "" and the homepage simply omits the line --
// social proof is never worth inventing.
function parseStarsJson(text) {
  var parsed = parseJsonBody(text)
  if (!parsed.ok) return ""
  var v = parsed.value
  if (typeof v.formatted === "string" && /^[0-9][0-9.,]*k?\+?$/i.test(v.formatted)) return v.formatted
  var n = Number(v.stars)
  if (!isFinite(n) || n <= 0) return ""
  return n >= 1000 ? ((n / 1000).toFixed(1) + "k") : String(n)
}

// Stargazers for the avatar row. Accepts both shapes: the JSON route in
// tools/website-stars-endpoint.ts ({avatars:[{login,avatar}]}) and GitHub's own
// /stargazers ([{login,avatar_url}]), so the plugin works before that route is
// deployed and improves the moment it is.
//
// Avatar URLs are validated as https and capped, exactly like a booking link --
// they are strings from a third party heading for an <Image>.
function parseStargazers(text, limit) {
  var cap = (isFinite(limit) && limit > 0) ? limit : 5
  var parsed = parseJsonBody(text)
  if (!parsed.ok) return []
  var list = Array.isArray(parsed.value) ? parsed.value : parsed.value.avatars
  if (!Array.isArray(list)) return []
  var out = []
  for (var i = 0; i < list.length && out.length < cap; i++) {
    var u = list[i]
    if (!u || typeof u !== "object") continue
    var login = safeText(u.login, 40)
    if (login.length === 0) continue
    var avatar = safeHttpsUrl(u.avatar || u.avatar_url)
    out.push({ login: login, avatar: avatar, tint: avatarTint(login) })
  }
  return out
}

// Deterministic accent for the initials fallback, mirroring the site's
// FALLBACK_COLORS so an avatarless account looks the same in both places.
var AVATAR_TINTS = ["#f47a1c", "#0b476b", "#2e9e6b", "#7b5cff", "#e0457b", "#1f9bd1", "#d99b00", "#5566ee"]

function avatarTint(login) {
  var s = safeText(login, 40)
  var h = 0
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

function avatarInitials(login) {
  var cleaned = safeText(login, 40).replace(/[^a-zA-Z0-9]/g, "")
  return (cleaned.slice(0, 2) || "lf").toUpperCase()
}

// Interim path for the faces, until tools/website-stars-endpoint.ts is
// deployed: letsfg.co's own homepage already server-renders the avatar URLs,
// so they are lifted from that HTML rather than calling GitHub directly.
//
// GitHub was the obvious alternative and is the wrong dependency: it is a
// third host, its unauthenticated API allows 60 requests an hour per IP, and
// it answered 401 outright from a normal network during testing. Our page is
// cached, already public, and is where the site itself gets them.
//
// Strictly bounded: only avatars.githubusercontent.com URLs, only the shape an
// avatar URL has, deduplicated, capped. Anything else is ignored, and nothing
// here can produce a URL pointing somewhere else.
var AVATAR_HOST_RE = /https:\/\/avatars\.githubusercontent\.com\/u\/([0-9]{1,12})(\?v=[0-9]{1,3})?/g

function parseStargazersFromHtml(html, limit) {
  var cap = (isFinite(limit) && limit > 0) ? limit : 5
  var s = typeof html === "string" ? html : ""
  if (s.length === 0 || s.length > MAX_RESPONSE_CHARS) return []
  var out = []
  var seen = {}
  AVATAR_HOST_RE.lastIndex = 0
  var m
  while ((m = AVATAR_HOST_RE.exec(s)) !== null && out.length < cap) {
    var id = m[1]
    if (seen[id]) continue
    seen[id] = true
    var url = safeHttpsUrl(m[0])
    if (url.length === 0) continue
    // No login is rendered into that HTML, so the id stands in for the tint
    // and the initials fallback is the generic mark.
    out.push({ login: "u" + id, avatar: url, tint: avatarTint(id) })
  }
  return out
}

function parseStarsBadge(svgText) {
  var s = safeText(svgText, 4000)
  var m = s.match(/GitHub stars:\s*[^0-9]*([0-9][0-9.,]*k?)/i)
  return m ? m[1] : ""
}

// ---- Calendar --------------------------------------------------------------
//
// The site opens a month grid rather than asking anyone to type an ISO date.
// Pure grid maths so the QML only has to draw it.

var WEEKDAY_INITIALS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

function isoFor(year, month, day) {
  return year + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function monthTitle(year, month) {
  if (month < 1 || month > 12) return ""
  return MONTH_SHORT[month - 1] + " " + year
}

// A six-row grid of ISO dates, Monday-first, with "" for the padding cells.
// Returns { cells: [...], year, month }.
function monthGrid(year, month) {
  var cells = []
  if (month < 1 || month > 12) return { cells: cells, year: year, month: month }
  // getUTCDay is Sunday-first; shift so Monday is column 0.
  var lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
  var total = daysInMonth(year, month)
  for (var i = 0; i < lead; i++) cells.push("")
  for (var d = 1; d <= total; d++) cells.push(isoFor(year, month, d))
  while (cells.length % 7 !== 0) cells.push("")
  return { cells: cells, year: year, month: month }
}

function stepMonth(year, month, delta) {
  var idx = (year * 12) + (month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

function dayOf(iso) {
  var m = safeText(iso, 12).match(/^\d{4}-\d{2}-(\d{2})$/)
  return m ? String(parseInt(m[1], 10)) : ""
}

// ---- Sorting and filtering -------------------------------------------------
//
// All of it runs over offers already in hand. Re-sorting or narrowing NEVER
// issues a request: the whole point is that refining what you are looking at
// costs nothing, while a new search costs money and quota.

var SORTS = [
  { key: "best", label: "Best" },
  { key: "cheapest", label: "Cheapest" },
  { key: "fastest", label: "Fastest" }
]

var STOP_FILTERS = [
  { key: "any", label: "Any stops" },
  { key: "nonstop", label: "Nonstop only" },
  { key: "one", label: "1 stop or fewer" }
]

var BAG_FILTERS = [
  { key: "any", label: "Any bags" },
  { key: "cabin", label: "Cabin bag included" },
  { key: "checked", label: "Checked bag included" }
]

var TIME_FILTERS = [
  { key: "any", label: "Any time" },
  { key: "morning", label: "Morning (05–12)" },
  { key: "afternoon", label: "Afternoon (12–18)" },
  { key: "evening", label: "Evening (18–05)" }
]

// The results list's sort, ported from the page the panel mirrors:
// website/app/flow/FlowResults.tsx -> sortCards().
//
// This is NOT rankOffers. That was the mistake: rankOffers is the 9-dimension
// persona ranker used for the hero/top-3 slots, and the panel was ordering its
// whole list by it while letsfg.co's results page orders by the blend below.
// On GDN->LAX the page's top was LOT, 1 stop, 14h15m while the panel's was a
// cheaper 2-stop 18h20m Ryanair -- both "correct", from two different sorts.
//
// "Best" blends price and total duration, each min-max normalised WITHIN THE
// CURRENT FILTERED SET (so it adapts to the range this search actually has),
// plus a small per-stop penalty capped at 0.15. Lower is better, price breaks
// ties. Deliberately un-clever -- "cheapest+fastest with a stops tiebreak".
//
// Keep this in step with sortCards(). If that function changes, this must too;
// tools/check-ranking-parity.ts compares them on a real payload.
// The rest of letsfg.co's allCards pipeline, after deduplicateOffers:
// drop non-positive prices, sort by price, then drop repeated ids keeping the
// first (which is the cheapest, because the list is already price-sorted).
//
// Skipping this is why the panel counted 201 where the page counted 197: the
// page removes zero-priced offers and collapses duplicate ids, and the panel
// did neither.
function dedupePricedOffers(offers) {
  var list = [], i, o, p
  for (i = 0; i < (offers || []).length; i++) {
    o = offers[i]
    if (!o || typeof o !== "object") continue
    p = (typeof o.price === "number") ? o.price : parseFloat(o.price)
    if (!isFinite(p) || p <= 0) continue
    list.push(o)
  }
  list.sort(function (a, b) {
    var av = (typeof a.price === "number") ? a.price : parseFloat(a.price)
    var bv = (typeof b.price === "number") ? b.price : parseFloat(b.price)
    return av - bv
  })
  var seen = {}, out = []
  for (i = 0; i < list.length; i++) {
    var id = list[i].id
    if (typeof id === "string" && id.length > 0) {
      if (Object.prototype.hasOwnProperty.call(seen, id)) continue
      seen[id] = true
    }
    out.push(list[i])
  }
  return out
}

function sortOffers(offers, key) {
  var list = (offers || []).slice()
  var dur = function (o) { return o && o.durationMinutes > 0 ? o.durationMinutes : Infinity }
  var pri = function (o) { return o && o.priceValue >= 0 ? o.priceValue : Infinity }

  if (key === "cheapest") {
    list.sort(function (a, b) { return pri(a) - pri(b) || dur(a) - dur(b) })
    return list
  }
  if (key === "fastest") {
    list.sort(function (a, b) { return dur(a) - dur(b) || pri(a) - pri(b) })
    return list
  }
  if (list.length === 0) return list

  var i, prices = [], durations = []
  for (i = 0; i < list.length; i++) { prices.push(pri(list[i])); durations.push(dur(list[i])) }
  // Guard the normalisers against a non-finite entry so one bad offer cannot
  // turn every score into NaN and scramble the whole list.
  var finite = function (arr) {
    var out = []
    for (var j = 0; j < arr.length; j++) if (isFinite(arr[j])) out.push(arr[j])
    return out.length > 0 ? out : [0]
  }
  var fp = finite(prices), fd = finite(durations)
  var pMin = Math.min.apply(null, fp)
  var pSpan = Math.max(1, Math.max.apply(null, fp) - pMin)
  var dMin = Math.min.apply(null, fd)
  var dSpan = Math.max(1, Math.max.apply(null, fd) - dMin)

  var score = function (o) {
    var p = pri(o), d = dur(o)
    var pNorm = isFinite(p) ? (p - pMin) / pSpan : 1
    var dNorm = isFinite(d) ? (d - dMin) / dSpan : 1
    var stops = (o && isFinite(o.stopCount) && o.stopCount > 0) ? o.stopCount : 0
    return pNorm * 0.6 + dNorm * 0.35 + Math.min(0.15, stops * 0.05)
  }
  list.sort(function (a, b) { return score(a) - score(b) || pri(a) - pri(b) })
  return list
}

function filterOffers(offers, f) {
  var list = offers || []
  var opts = f || {}
  var out = []
  for (var i = 0; i < list.length; i++) {
    var o = list[i]
    if (!o) continue

    if (opts.stops === "nonstop" && o.stopCount !== 0) continue
    if (opts.stops === "one" && !(o.stopCount >= 0 && o.stopCount <= 1)) continue

    if (opts.bags === "cabin" && !o.bags.cabin) continue
    if (opts.bags === "checked" && !o.bags.checked) continue

    if (opts.time && opts.time !== "any") {
      var h = o.departHour
      if (h < 0) continue
      if (opts.time === "morning" && !(h >= 5 && h < 12)) continue
      if (opts.time === "afternoon" && !(h >= 12 && h < 18)) continue
      if (opts.time === "evening" && (h >= 5 && h < 18)) continue
    }

    var cap = Number(opts.maxPrice)
    if (isFinite(cap) && cap > 0 && o.priceValue >= 0 && o.priceValue > cap) continue

    if (opts.airline && opts.airline !== "any" && o.airline !== opts.airline) continue

    out.push(o)
  }
  return out
}

// Carriers present in a result set, cheapest-first, for the Airlines filter.
function airlinesIn(offers) {
  var best = {}
  var list = offers || []
  for (var i = 0; i < list.length; i++) {
    var o = list[i]
    if (!o || !o.airline) continue
    var p = o.priceValue < 0 ? Infinity : o.priceValue
    if (!(o.airline in best) || p < best[o.airline]) best[o.airline] = p
  }
  var names = Object.keys(best)
  names.sort(function (a, b) { return best[a] - best[b] })
  var out = [{ key: "any", label: "All airlines" }]
  for (var n = 0; n < names.length && n < 12; n++) out.push({ key: names[n], label: names[n] })
  return out
}

// Price steps for the Max price filter, derived from the set in hand so the
// choices are always meaningful for this route rather than fixed constants.
function priceSteps(offers) {
  var vals = []
  var list = offers || []
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].priceValue >= 0) vals.push(list[i].priceValue)
  var out = [{ key: "0", label: "Any price" }]
  if (vals.length === 0) return out
  vals.sort(function (a, b) { return a - b })
  var cur = (list[0] && list[0].currency) || ""
  var lo = vals[0], hi = vals[vals.length - 1]
  if (hi <= lo) return out
  for (var q = 1; q <= 3; q++) {
    var step = Math.ceil((lo + (hi - lo) * (q / 4)) / 5) * 5
    out.push({ key: String(step), label: "Under " + money(step, cur) })
  }
  return out
}

// ---- Throttle and circuit breaker ------------------------------------------
//
// The server limits per token; this limits per panel. A shell plugin lives in a
// process that runs for weeks and reloads itself on file change, so the thing
// most likely to hammer the API is not a malicious user -- it is a bug here.

// Returns { allowed, waitMs, reason }.
function throttleCheck(gate, nowMs) {
  var g = gate || {}
  var now = Number(nowMs) || 0

  if (g.inFlight) return { allowed: false, waitMs: 0, reason: "A search is already running." }

  if (g.breakerOpen)
    return { allowed: false, waitMs: 0, reason: "Paused after repeated failures. Press Retry to try again." }

  var blockedUntil = Number(g.blockedUntilMs) || 0
  if (blockedUntil > now) {
    var wait = blockedUntil - now
    return { allowed: false, waitMs: wait, reason: "Rate limited. Try again in " + Math.ceil(wait / 1000) + "s." }
  }

  var last = Number(g.lastSearchAtMs) || 0
  if (last > 0 && (now - last) < MIN_SEARCH_INTERVAL_MS) {
    var left = MIN_SEARCH_INTERVAL_MS - (now - last)
    return { allowed: false, waitMs: left, reason: "Just a moment -- " + Math.ceil(left / 1000) + "s." }
  }

  return { allowed: true, waitMs: 0, reason: "" }
}

function noteFailure(gate) {
  var g = gate || {}
  var fails = (Number(g.consecutiveFailures) || 0) + 1
  return { consecutiveFailures: fails, breakerOpen: fails >= BREAKER_TRIP_AFTER }
}

module_exports_shim()

// Node reads this file for the unit tests; QML does not have module.exports and
// must not see a reference to it at load time. Wrapping the assignment in a
// function that checks for the symbol keeps one file valid in both.
function module_exports_shim() {
  if (typeof module === "undefined" || !module || typeof module.exports !== "object") return
  module.exports = {
    API_ORIGIN: API_ORIGIN, MAX_RESPONSE_CHARS: MAX_RESPONSE_CHARS,
    MAX_RENDERED_OFFERS: MAX_RENDERED_OFFERS, POLL_INTERVAL_MS: POLL_INTERVAL_MS,
    POLL_TIMEOUT_MS: POLL_TIMEOUT_MS, GRACE_POLL_MS: GRACE_POLL_MS, GRACE_POLLS: GRACE_POLLS, GRACE_WATCHDOG_MS: GRACE_WATCHDOG_MS, MAX_POLLS: MAX_POLLS,
    MIN_SEARCH_INTERVAL_MS: MIN_SEARCH_INTERVAL_MS, BREAKER_TRIP_AFTER: BREAKER_TRIP_AFTER,
    CABINS: CABINS, PALETTE: PALETTE, initials: initials,
    LOGO_CDN_PRIMARY: LOGO_CDN_PRIMARY, LOGO_CDN_FALLBACK: LOGO_CDN_FALLBACK,
    airlineLogoUrl: airlineLogoUrl, airlineLogoFallbackUrl: airlineLogoFallbackUrl,
    distinctCarriers: distinctCarriers, bagsFor: bagsFor,
    retryAfterFromBody: retryAfterFromBody,
    safeText: safeText, safeHttpsUrl: safeHttpsUrl, redact: redact,
    apiUrl: apiUrl, searchUrl: searchUrl, resultsUrl: resultsUrl, offerUrl: offerUrl,
    parseTokenConfig: parseTokenConfig, createSession: createSession,
    agentRequestUrl: agentRequestUrl, agentVerifyUrl: agentVerifyUrl,
    parseAgentRequest: parseAgentRequest, parseAgentVerify: parseAgentVerify,
    buildTokenConfig: buildTokenConfig,
    normalizeIata: normalizeIata, isValidIata: isValidIata, isValidDate: isValidDate,
    isValidCabin: isValidCabin, buildSearchBody: buildSearchBody,
    parseJsonBody: parseJsonBody, describeHttpError: describeHttpError,
    parseRateLimit: parseRateLimit, parseSearchAck: parseSearchAck,
    isAuthFailure: isAuthFailure,
    isTerminalStatus: isTerminalStatus, pollDecision: pollDecision, mergeOffers: mergeOffers,
    dedupePricedOffers: dedupePricedOffers,
    summarizeOffers: summarizeOffers, cheapestLabel: cheapestLabel,
    formatDuration: formatDuration, formatPrice: formatPrice, stopsLabel: stopsLabel,
    clockTime: clockTime, shortDate: shortDate, dayOffset: dayOffset, dayLabel: dayLabel,
    money: money, placeLabel: placeLabel, shortDayLabel: shortDayLabel,
    parseTransfers: parseTransfers,
    hotelDestinationsUrl: hotelDestinationsUrl, hotelSearchUrl: hotelSearchUrl,
    parseHotelDestinations: parseHotelDestinations, buildHotelSearchBody: buildHotelSearchBody,
    summarizeHotels: summarizeHotels, nightsBetween: nightsBetween,
    allowedHotelImage: allowedHotelImage, HOTEL_TIMEOUT_MS: HOTEL_TIMEOUT_MS,
    newInstallId: newInstallId, isValidInstallId: isValidInstallId,
    loadAirports: loadAirports, loadNameFallbacks: loadNameFallbacks, nameFallback: nameFallback, searchAirports: searchAirports,
    airportName: airportName, airportCountry: airportCountry,
    airportCount: airportCount, foldForSearch: foldForSearch,
    airportCoord: airportCoord, tileUrl: tileUrl, tileGrid: tileGrid,
    projectInto: projectInto, TILE_SIZE: TILE_SIZE, TILE_HOST: TILE_HOST,
    TILE_ATTRIBUTION: TILE_ATTRIBUTION, lonToTileX: lonToTileX, latToTileY: latToTileY,
    travelerLabel: travelerLabel, bagLines: bagLines, warningFor: warningFor,
    layoverParts: layoverParts, layoverLabel: layoverLabel, starlinkChip: starlinkChip,
    longestLayover: longestLayover,
    SORTS: SORTS, STOP_FILTERS: STOP_FILTERS, BAG_FILTERS: BAG_FILTERS, TIME_FILTERS: TIME_FILTERS,
    CURRENCIES: CURRENCIES, isValidCurrency: isValidCurrency,
    parseStarsJson: parseStarsJson, parseStarsBadge: parseStarsBadge,
    parseStargazers: parseStargazers, avatarTint: avatarTint,
    parseStargazersFromHtml: parseStargazersFromHtml,
    parsePopularFromHtml: parsePopularFromHtml, allowedPopularImage: allowedPopularImage,
    avatarInitials: avatarInitials, POPULAR: POPULAR,
    monthGrid: monthGrid, stepMonth: stepMonth, monthTitle: monthTitle,
    daysInMonth: daysInMonth, isoFor: isoFor, dayOf: dayOf, WEEKDAY_INITIALS: WEEKDAY_INITIALS,
    sortOffers: sortOffers, filterOffers: filterOffers, airlinesIn: airlinesIn, priceSteps: priceSteps,
    throttleCheck: throttleCheck, noteFailure: noteFailure
  }
}
