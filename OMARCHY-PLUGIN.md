# LetsFG Flights — an Omarchy bar plugin

> The plugin ships from this repository: `manifest.json`, `BarWidget.qml`,
> `Panel.qml` and `Model.js` are at the root, which is where Omarchy's
> `plugin add` looks. Every path below is relative to the repository root.

Search hundreds of airlines from the Omarchy bar. Type two airport codes and a
date, press Search, and click an offer to open it in your browser.

Search runs server-side at [letsfg.co](https://letsfg.co) — the same engine
behind the LetsFG CLI and MCP server — covering low-cost carriers (Ryanair,
Wizz Air, easyJet, Southwest, AirAsia…) alongside GDS/NDC feeds, including
cross-airline round-trips that no single carrier sells.

**The plugin bundles no API keys.** It uses a token you create yourself with
the official LetsFG CLI, so every request is yours, rate-limited to you, and
revocable by you. See [Privileges and data](#privileges-and-data).

---

## Requirements

| Dependency | Why | Notes |
|---|---|---|
| Omarchy Quattro shell | Host for the plugin | Uses `Quickshell`, `Quickshell.Io`, `qs.Commons`, `qs.Ui` |
| A LetsFG token | Authenticates your searches | Created by `letsfg auth`, below |
| Network access to `letsfg.co` | Search | HTTPS only |

No other runtime dependencies. The plugin spawns no processes, bundles no
binaries, and ships no third-party code.

---

## Install

```bash
omarchy plugin add https://github.com/LetsFG/LetsFG.git --enable
```

Then add **LetsFG Flights** to a bar section in the Omarchy bar settings.

### Connect

**In the panel.** Open it and press **Add a card to continue**. Stripe's hosted
page opens in your browser; add a card there — it is a zero-amount setup, so
**nothing is charged** — then come back and press **I have added my card**. You
get a 90-day token and search is free and unlimited.

Card details are only ever entered on Stripe's own page. The plugin never asks
for them, never sees them, and only ever opens a URL whose host it has checked
is `checkout.stripe.com`.

**Or with the CLI**, if you prefer, and the panel will pick that token up:

```bash
pip install letsfg
letsfg auth
```

The plugin watches that file and re-reads it when the panel opens, so you can
run `letsfg auth` in a terminal and it is picked up without restarting the
shell. When the token is missing or expired the panel says so and Search does
nothing — no request is made. The panel also warns you in the week before the
token expires.

## Remove

```bash
omarchy plugin remove io.github.letsfg.flights
```

This removes the plugin only. Your token is yours: delete `~/.letsfg/config.json`
yourself if you want it gone.

---

## Usage

The panel opens as the site's homepage and becomes the results page once a
search returns. Clicking the flame logo goes back.

| Field | How it works |
|---|---|
| **From** / **To** | Click and type a city or airport — `gdan` finds Gdansk (GDN). 7,900 airports, matched locally with no network call. Multi-airport metros (London, New York, Paris…) are offered first and search every airport in the city. |
| **Dates** | A month grid, like the site: first click sets departure, second sets the return, or press **One way**. |
| **Travelers** | 1–9 |
| **Currency** | The pill in the header |

Once results are in, **Best / Stops / Times / Airlines / Max price / Bags** all
work — and all of them run over offers already fetched, so refining costs
nothing while a new search costs money and quota.

**Offers are ordered by letsfg.co's own ranking**, not by the order
`/api/search` happens to return them in — those are not the same thing, and
using the raw order made the list visibly disagree with the website.
`assets/ranking.js` is compiled from the public SDK's `ranking.ts` ("the
scoring algorithm that powers letsfg.co") by `tools/build-ranking.py`, so the
plugin runs the site's code rather than a reimplementation that would drift.
It also deduplicates the same flight resold by several connectors, which is why
the count is lower than the raw offer total.

Press **Enter** in any field, or click **Search**. Results arrive in a few
seconds; the panel shows the fastest sources as soon as they settle rather than
waiting on the slowest one. Click any offer to open it in your browser.

The bar label shows a plane glyph, and the cheapest price from your last search
once one has completed.

**Place search runs locally.** The token lane has no name-to-airport endpoint,
and a request per keystroke would be the wrong shape even if it did — so
`assets/airports.json` is distilled from the site's own tables by
`tools/build-airports.py`. Re-run that when the website's tables change.

### Optional configuration

The plugin **never writes your configuration.** If you want defaults, set them
yourself on the widget's entry in `shell.json`:

| Key | Effect |
|---|---|
| `defaultOrigin` | Pre-fills **From** (e.g. `"WAW"`) |
| `defaultDestination` | Pre-fills **To** |
| `defaultCabin` | `"M"` economy, `"W"` premium, `"C"` business, `"F"` first |
| `airlineLogos` | `false` turns off logo fetching, so the plugin contacts only `letsfg.co`. Cards show carrier initials instead. |
| `socialProof` | `false` hides the stargazer faces and skips the avatar host entirely. |
| `map` | `false` hides the results map, so no tile host is contacted. |
| `currency` | Starting currency, e.g. `"USD"`. Also changeable from the header pill. |

### Summoning from a keybind

```bash
omarchy-shell shell summon "io.github.letsfg.flights" '{}'
omarchy-shell shell hide "io.github.letsfg.flights"
```

The IPC surface is `open`, `close`, `show`, `hide`, `toggle`. There is
deliberately **no `search` method** — see below.

---

## Why there is no auto-refresh

The plugin never searches on its own. There is no background poll, no price
watch, no refresh timer, and no IPC method that starts a search. A search
begins only when you click **Search** or press Enter in a field.

That is a deliberate constraint, for three reasons that all point the same way:

1. **A search costs LetsFG real money upstream.** Every search fans out to live
   airline and meta-search sources. A widget that quietly re-priced a route
   every five minutes across every install would be an expensive outage
   wearing a feature's clothes.
2. **The shell is one long-running process that reloads plugins on file
   change.** The thing that actually hammers an API from a desktop widget is
   never a malicious user — it is a refresh loop nobody noticed, running for
   weeks.
3. **Your token's quota is small and measured.** The Bearer lane allows
   **3 searches per 10 minutes, 10 per hour, and 25 per day** — that is the
   server's own wording in its 429, not an estimate. A background refresh would
   spend the lot without you asking. When you do hit it, the panel reads the
   `retry_after_seconds` the server sends and stays blocked for exactly that
   long rather than letting you earn another strike.

So the rule is mechanical and checkable rather than a matter of care:
`beginSearch()` is called from exactly five places in `Panel.qml` — the Search
button's `onClicked`, and `onAccepted` on each of the four fields — and from
nowhere else. `tools/validate.sh` fails the build if that ever stops being
true.

```bash
grep -n 'beginSearch()' Panel.qml
```

On top of that, the panel throttles itself: one search at a time, a minimum
interval between searches, a circuit breaker that pauses after repeated
failures until you press **Retry**, and it honours a `Retry-After` from the
server. The quota line under the form reports what the server said on the last
response — never a number compiled into the plugin.

---

## Privileges and data

Omarchy plugins run **unsandboxed, in the shell process, with your full user
permissions**. That is true of every plugin, including this one, so here is
exactly what this one does.

**What it reads**

- `~/.letsfg/config.json` — read-only, for your token. Written by `letsfg auth`;
  this plugin never writes it.
- Its own entry in `shell.json`, for the optional defaults above — read-only.

**What it writes**

Two files, both inside Quickshell's own per-shell state directory
(`~/.local/state/quickshell/by-shell/<id>/`), and nothing anywhere else.

- **Your access token**, and only when you sign in from the panel.
  It goes to Quickshell's own per-shell state directory
  (`~/.local/state/quickshell/by-shell/<id>/letsfg-auth.json`), in the same
  `{"pfs_auth": {"token", "expires_at"}}` shape `letsfg auth` uses.

  Not `~/.letsfg/config.json`: `FileView` writes atomically by renaming into
  the target directory, so that path fails outright when `~/.letsfg` does not
  exist — which is exactly the case for anyone who has never run the CLI.
  Creating it would mean spawning `mkdir`, and this plugin spawns no
  processes. The CLI's file is still **preferred on read**, so if you have run
  `letsfg auth` that token keeps winning and the two never disagree.
- **An anonymous installation id** — `letsfg-install.json`, written once, on
  first run. 24 random lowercase characters and nothing else. What it is for and
  where it goes is under [What it sends](#privileges-and-data) below; delete the
  file and it is forgotten.
- Nothing else. No configuration is modified, no cache, no logs.

**What it sends, and where**

- HTTPS requests to `https://letsfg.co`: `POST /api/search` and
  `GET /api/results/<id>`. The host is a constant in `Model.js`; there is no
  base-URL override from the environment or anywhere else, because such an
  override is a credential-exfiltration switch whose only benefit is developer
  convenience.
- **The homepage's social proof** — the star count and the stargazer faces.
  First `GET /api/stars/social` on letsfg.co, which carries both. Until
  letsfg.co serves that route, the count comes from the existing
  `GET /api/stars/badge` and the avatar URLs are read out of
  letsfg.co's own homepage HTML, which already server-renders them. All of
  that is letsfg.co, and a failure hides the line rather than inventing a
  number.
  **Not GitHub's API**: it is a third host, allows 60 unauthenticated calls an
  hour per IP, and returned 401 outright from a normal network in testing.
- **Map tiles from `https://basemaps.cartocdn.com`**, for the results map, and
  **`POST /api/transfers/airport`** on letsfg.co for the ground-transport pill.
  The tile host sees your IP and which map squares were requested — roughly,
  which city you searched. Nine to twelve tiles per search, no token, no query.
  CARTO rather than `tile.openstreetmap.org` because OSM's tile policy asks
  every client to send an identifying User-Agent and Qt's `Image` cannot set
  one; using it would mean quietly breaking their terms. Attribution is drawn
  on the map, as the licence requires. `"map": false` turns the whole pane off.
- **Stargazer avatar images from `https://avatars.githubusercontent.com`** —
  the same host letsfg.co's own homepage loads them from. Image GETs only; the
  URLs are validated as https and restricted to that host before an `Image`
  ever sees them. Set `"socialProof": false` in `shell.json` and the plugin
  never contacts it and the row does not appear.
- **Airline logo images from `https://images.kiwi.com`, falling back to
  `https://pics.avs.io`** — the same two CDNs letsfg.co itself uses, in the same
  order. Worth being precise about what that means: the CDN sees your IP and
  which carrier marks were requested, which loosely implies the routes you
  searched. **No token, no query, and no personal data are ever sent there** —
  the request is a plain image GET.
  The URL is *built* from the offer's `airline_code` after validating it as
  exactly two `A-Z0-9` characters, and re-checked against the CDN prefix; a URL
  string in the API response is never followed, so a hostile response cannot
  aim the image anywhere. Set `"airlineLogos": false` in `shell.json` and the
  plugin never contacts either, falling back to carrier initials.
- **Popular-destination card images**, on the homepage only, from
  `https://images.pexels.com` and `https://upload.wikimedia.org` — the hosts
  letsfg.co's own image resolver picks for those cards, plus letsfg.co itself
  for the six bundled ones. Those three are an allowlist, not a redirect the
  plugin follows: the card URLs are read out of the site's server-rendered
  homepage, and an `<img>` URL taken from parsed markup is exactly the kind of
  string that must not be able to point wherever it likes. Image GETs, no token,
  no query.
- Your token travels as an `Authorization: Bearer` header, and the code refuses
  to attach it to any URL not on that origin.
- **Nothing to the two hotel photo CDNs** (`i.travelapi.com`, `q-xx.bstatic.com`)
  whose names still appear in `Model.js`. This build is flights only — the
  Hotels tab was removed — so that allowlist is unreachable code and no request
  is ever made to either host. Said plainly here because a reviewer will find
  the constants, and an undisclosed host in a document like this one should
  cost trust even when it is dead.
- Sent with each search: the route, dates, cabin and passenger count you typed.
- **An anonymous installation id**, on the search request only. Two headers ride
  along with `POST /api/search`: `X-LetsFG-Client`, which is the string
  `omarchy-plugin-letsfg/1.0.0`, and `X-LetsFG-Install`, which is 24 random
  lowercase characters generated on this machine the first time the panel runs
  and kept in Quickshell's state directory next to your token
  (`letsfg-install.json`).

  It exists to answer one question — whether anyone is using this plugin — and
  it is the difference between counting *searches* and counting *installs*: one
  person searching ten times and ten people searching once are otherwise the
  same number. On the server it labels the search session and nothing else. It
  grants nothing, unlocks nothing, and is never used for pricing, quota or
  access.

  It is **not identity**: no account, no email, no device fingerprint, nothing
  derived from your machine, and nothing that survives it. A fresh install is a
  fresh id, and deleting that one file forgets it permanently — the panel simply
  mints a new one. Nothing else about you is collected, and no third party
  receives it.

  If you would rather not send it, delete the two `setRequestHeader` lines in
  `Panel.qml` that name those headers; the plugin works exactly the same without
  them.

**What it never does**

- Bundle a shared or embedded API key. Every install authenticates as its own
  user, so a misbehaving install can only spend its own quota.
- **Ask for card details.** Signing in opens Stripe's hosted page in your
  browser. The plugin has no card fields, and refuses to open a setup link
  whose host is not `checkout.stripe.com` — an open redirect there would be a
  phishing vector for exactly the data this flow must never touch.
- Send your token, your search terms, or any identifier anywhere except
  `letsfg.co` — including the installation id above, which goes to that one host
  and nowhere else. The logo CDN receives an image request and nothing else.
- Execute a shell command. Booking links open via `Qt.openUrlExternally`, which
  hands the URL to the desktop opener as a single value — there is no shell and
  no argv to quote, so there is no command-injection surface.
- **Book anything, or touch a payment method.** The plugin is read-only against
  your account: it searches and opens links. Booking needs passport-exact
  passenger details and money, and neither belongs in a bar widget.

  Clicking a flight opens that exact offer on letsfg.co — the same deep link
  the site uses (`?stage=results&sid=…&offer=…`), built from the search id,
  because `/api/search` returns no booking URL of its own. The booking itself
  finishes on the website.

**Handling of responses.** Every value that comes back over the network is
treated as untrusted: length-capped, stripped of control characters and
bidirectional overrides before it can reach a text label, and rendered as
`Text.PlainText`. **Booking URLs must be on `letsfg.co`** — they pass an https
shape check (scheme, hostname shape, no userinfo, no control characters) and
are then pinned to that one origin, so a response cannot choose which page your
browser opens; an offer whose URL fails is shown but not clickable. The shape
check alone is not enough for that job and is not asked to do it:
`https://checkout.stripe.com.evil.com/x` is a well-formed https URL that reads
like Stripe at a glance, which is why the origin check exists on top of it. Response bodies are size-checked before parsing, since
a large `JSON.parse` in the shell process is a frozen desktop, and a non-JSON
body (an HTML error page) is an error message rather than an exception.

**Your token is as safe as your home directory.** The plugin keeps it in a
closure rather than a QML property, so it is not casually readable by other
plugins sharing the QML engine. Be clear-eyed about what that is worth: any
unsandboxed plugin can read `~/.letsfg/config.json` directly. The measure keeps
this plugin from making things worse; it is not a security boundary, and no
plugin in an unsandboxed shell can give you one. Install plugins you trust.

If you believe you have found a security issue, see [SECURITY.md](SECURITY.md).

---

## What has and has not been verified

Honest accounting, because the marketplace listing is explicitly not a security
review.

**Verified.** The logic in `Model.js` — input validation, URL allowlisting,
token parsing and confinement, response parsing, the poll state machine, offer
shaping, throttling — is covered by 432 assertions that run without Qt:

```bash
node test/model-test.js
```

The manifest and layout are checked by `tools/validate.sh`, which mirrors the
documented `omarchy plugin validate` rules — including the rule that
`beginSearch()` is only ever called from a click or a keypress.

The API contract was checked live against `letsfg.co` with an unauthenticated
request (which bills nothing and fans out to no airline): `POST /api/search`
exists, a plain HTTP client is not blocked before authentication, and an auth
failure returns JSON — `{"error":"Unauthorized","code":"NO_SESSION"}` — rather
than an HTML error page.

**The QML has been run, and a real search has gone through it.** Omarchy's shell
is Quickshell on Wayland and cannot run on every machine, but the plugin is
ordinary QML — so `preview/` stubs the modules it imports (`Quickshell`,
`Quickshell.Io`, `qs.Commons`, `qs.Ui`) and loads the real, unmodified
`BarWidget.qml` and `Panel.qml` in any Qt 6 QML engine:

```bash
pip install PySide6-Essentials
python preview/build_stubs.py
python preview/run.py                     # the panel, in a window
python preview/run.py --strict            # fail on any QML warning
LETSFG_BEARER_TOKEN=... python preview/run.py --search WAW LIS   # a real search
```

That loads clean — zero QML warnings — and live searches go all the way through
it: `WAW → LIS` returned 194 real offers and `GDN → WAW` 142, both rendered,
ranked and pushed to the bar label.

**Still not verified.** The preview stubs are stand-ins: they prove the plugin's
QML parses, that every property and signal name resolves, that the bindings
evaluate and the JavaScript runs — **not** that the real `qs.Ui` components lay
out or behave identically. Layout and styling in the preview are approximations.
Nothing has been loaded by a real Omarchy shell. Before relying on it:

```bash
omarchy plugin validate "$PLUGIN_DIR"
qmllint -I "$OMARCHY_PATH/shell" "$PLUGIN_DIR/BarWidget.qml"
```

Issues and fixes welcome.

> The preview is a development tool. It is not needed to use the plugin, it runs
> nothing at shell startup, and `--search` simulates a click from the *harness* —
> `Panel.qml` still has no way to start a search on its own.

---

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Plugin identity and entry point |
| `BarWidget.qml` | Bar label; hosts the panel. No network code, no credentials |
| `Panel.qml` | Search form, requests, results |
| `Model.js` | Pure logic: validation, sanitisation, parsing, poll decisions |
| `test/model-test.js` | Unit tests for `Model.js` (`node test/model-test.js`) |
| `tools/validate.sh` | Offline manifest/layout check |
| `preview/` | Dev-only: run the real QML outside Omarchy (see above) |
| `assets/` | Brand mark, Lexend + Kalam (SIL OFL), Lucide icons (ISC), airport table |
| `tools/build-airports.py` | Regenerates `assets/airports.json` from the website |
| `tools/build-icons.py` | Rasterises the Lucide icons into tinted PNGs |
| `tools/build-ranking.py` | Compiles letsfg.co's ranking engine into `assets/ranking.js` |

---

## License

MIT — see [LICENSE](LICENSE).

Not affiliated with, sponsored by, or endorsed by Omarchy or 37signals.
