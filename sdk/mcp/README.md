# letsfg-mcp — Your AI agent just learned to book flights.

**Every airline in the world. Real prices. One tool call.** Search runs server-side at letsfg.co across airlines and the major booking sites.

**Your agent doesn't need to build a flight integration. Just add this MCP server.**

[![npm](https://img.shields.io/npm/v/letsfg-mcp)](https://www.npmjs.com/package/letsfg-mcp)
[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## What This Is

LetsFG is not a scraper wrapper. It's a production-grade **agent-to-airline connector layer**:

- **Every airline in the world** searched server-side at letsfg.co — approve once at letsfg.co/connect (no card) and search is free
- **Real booking** — `book_flight` holds the fare on that card, a LetsFG booking agent buys the ticket, and the hold is captured only once a real airline PNR exists
- **Virtual interlining** — the combo engine mixes one-way fares across airlines (e.g., Ryanair outbound + Wizz Air return) to find deals no single airline offers
- **City-wide airport expansion** — search `LON` and it auto-searches LHR, LGW, STN, LTN, SEN, LCY. Works for 25+ major cities worldwide
- **No tracking** — no cookies, no surge pricing. The same search returns the same prices; the price shown is the total you pay

**Why agents should use this instead of building their own:**
- Saves thousands of tokens vs. browser automation or scraping
- Server-side engine scans airlines across Europe, Asia, Americas, Middle East, Africa, and Oceania simultaneously
- Finds deals on carriers your agent wouldn't think to check (Lucky Air, 9 Air, Jazeera Airways, FlySafair...)

---

## Quick Start

**Recommended — the hosted MCP, no install:**

```
https://letsfg.co/developers/api/mcp
```

Add it as a remote MCP server in Claude, ChatGPT, Cursor or Windsurf (or
`claude mcp add --transport http letsfg https://letsfg.co/developers/api/mcp`
in Claude Code) and approve the connection. The consent step opens
[letsfg.co/connect](https://letsfg.co/connect), where you add a card (any
card, or Revolut Pay / Google Pay) in a 0.00 Revolut setup. Nothing is
charged, no Revolut account is needed, and the card details go to Revolut,
never to LetsFG. The token is card-backed: it searches and it books, and it
is carried on every tool call for you.

**This package — the stdio server, runs on your machine:**

```bash
npx letsfg-mcp
```

It needs that same card-backed token in `LETSFG_BEARER_TOKEN`. To mint one
from the command line, run **`letsfg auth`**: it registers itself as an OAuth
client, opens letsfg.co/connect for a person to approve, and writes the token to
`~/.letsfg/config.json` (`--no-browser` prints the URL instead). This server's
own `authenticate` tool returns the current instructions rather than minting a
token, since a person has to approve in a browser either way.

> **Retired 2026-09-02:** the Stripe card setup and every token it issued
> (401 `TOKEN_REVOKED`). Reconnect at letsfg.co/connect.

---

## Client Configuration

The hosted server is the simplest option everywhere: it does the connect
flow for you and needs no token in a config file.

### Claude (claude.ai / Claude Desktop / ChatGPT)

Add a custom connector with the URL `https://letsfg.co/developers/api/mcp`
and approve it. The consent step takes you through letsfg.co/connect.

### Claude Code

```bash
claude mcp add --transport http letsfg https://letsfg.co/developers/api/mcp
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "letsfg": { "url": "https://letsfg.co/developers/api/mcp" }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "letsfg": { "serverUrl": "https://letsfg.co/developers/api/mcp" }
  }
}
```

### The stdio server instead (`npx letsfg-mcp`)

Same shape in any of the files above, with the card-backed token from the
connect flow in the environment (a paid Developer API key in
`LETSFG_API_KEY` also works, on that separate product):

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_BEARER_TOKEN": "eyJ..."
      }
    }
  }
}
```

### Continue

Add to `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: letsfg
    command: npx
    args: ["-y", "letsfg-mcp"]
    env:
      LETSFG_BEARER_TOKEN: eyJ...
```

### Any MCP-Compatible Agent

Connect via remote MCP (no install, does the card connect for you):

```
https://letsfg.co/developers/api/mcp
```

Or run the stdio server with a token in `LETSFG_BEARER_TOKEN`:

```bash
npx letsfg-mcp
```

### Windows — `npx ENOENT` Fix

If you get `spawn npx ENOENT` on Windows, use the full path to `npx`:

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "C:\\Program Files\\nodejs\\npx.cmd",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_BEARER_TOKEN": "eyJ..."
      }
    }
  }
}
```

Or use `node` directly:

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\AppData\\Roaming\\npm\\node_modules\\letsfg-mcp\\dist\\index.js"],
      "env": {
        "LETSFG_BEARER_TOKEN": "eyJ..."
      }
    }
  }
}
```

### Pin a Specific Version

To avoid unexpected updates (2026.5.77 or later: earlier versions cannot book hotels):

```json
{
  "command": "npx",
  "args": ["-y", "letsfg-mcp@2026.5.77"]
}
```

---

## Available Tools

| Tool | Description | Cost | Side Effects |
|------|-------------|------|--------------|
| `search_flights` | Search hundreds of airlines via server-side engine | FREE | None (read-only) |
| `resolve_hotel_city` | Place name -> supplier city id | FREE | None (read-only) |
| `search_hotels` | Search bookable hotel rates (refundable and non-refundable) | Free up to 1,000/booking, then $5/1,000 — needs a connected payment method | Opens a supplier session |
| `book_hotel` | Start a hotel booking (async, returns a job id) | The price: held on the connected method, captured once the hotel confirms, released if it fails | Places a hold, books and pays the room |
| `get_hotel_booking` | Collect the booking result (`succeeded` / `failed` / `attention`) | FREE | None (read-only) |
| `cancel_hotel_booking` | Cancel this account's booking and refund the guest | Free on a refundable rate before `free_cancellation_until`; a cancellation that would cost money is refused | Cancels the booking |
| `resolve_location` | City name → IATA code | FREE | None (read-only) |
| `book_flight` | Start a real booking: fare held on the connected card, a LetsFG agent buys the ticket, captured on a real PNR | The price shown | Places a hold, creates the booking |
| `get_flight_booking` | Poll a booking started by `book_flight` until `completed` / `failed` / `needs_attention` | FREE | None (read-only) |
| `unlock_flight_offer` | **RETIRED 2026-09-08** — the tool refuses locally and the route answers `410 Gone` | — | Call `book_flight` directly |
| `connect_payment` | **Developer API only** — mint a link to connect a payment method to a paid prepaid account. Not how agents connect. Replaced `setup_payment` on 2026-09-08 with the Stripe lane | FREE | Returns `connect_url` |
| `get_agent_profile` | Usage stats & payment status | FREE | None (read-only) |

### Booking Flow

**PFS (card-backed token from letsfg.co/connect):**

```
connect (once)  →  search_flights  →  book_flight  →  get_flight_booking (poll)
  (0.00 setup)        (free)          (hold + agent)     (PNR in 4-11 min)
```

1. `search_flights("LON", "BCN", "2026-06-15")` — server-side search returns offers from hundreds of airlines in 8–10 s to first results; collect late arrivals with `get_flight_results`
2. `book_flight(search_id, offer_id, passengers, contact_email)` — exactly what the website checkout does: the price shown is **held** on the connected card (not taken), a LetsFG booking agent buys the ticket from the seller, and the hold is captured only once a real airline PNR exists. Returns a `booking_ref` within seconds. One traveller per call, with the details an airline checkout asks for (name, date of birth, gender, nationality, email, phone with its country, residence address; passport optional). A missing detail returns `missing_fields` and charges nothing.
3. `get_flight_booking(booking_ref)` every 20–30 s — `booking_in_progress` → `completed` (PNR, captured amount) | `failed` (hold released, nothing charged) | `needs_attention` (a human at LetsFG is checking; do not book again). A booking legitimately takes 4–11 minutes.

No unlock step, no booking-link fallback, no separate LetsFG fee. Never call
`book_flight` twice for the same trip while one is in progress — that would
place a second hold.

> The stdio server books through the same `/api/agent-book` hold + poll flow as the
> hosted MCP: `book_flight` returns a `booking_ref`, then `get_flight_booking`
> reports the outcome. It takes **one passenger per call** and refuses more rather
> than silently booking only the first. (Until 2026-09-02 this package had no
> `get_flight_booking` at all, so a stdio agent could start a booking and never
> learn whether it landed — that is fixed.)

**Developer API (look-to-book search, real booking, hotels):**

The [Developer API](https://letsfg.co/developers) books flights itself: `POST /flights/book` holds
the fare on a connected Revolut method and a LetsFG booking agent buys the ticket, exactly like
this package does. Every offer carries a `booking_url` that points at a letsfg.co page for that
offer — never a seller deep link. Search is 200 free after every booking, then $0.01. No booking
fee, no transaction fee. Use this path for volume, account-level billing, or hotels.

The agent has native tools — no API docs needed, no URL building, no token-burning browser automation.

### Response Mode (Remote MCP only)

`search_flights` and `search_hotels` accept an optional `response_mode` parameter:

| Mode | Default | What's returned | Best for |
|------|---------|----------------|----------|
| `"summary"` | ✅ | Price, airlines, route, departure, stops | Chat, quick comparisons |
| `"full"` | | Everything: segments, durations, conditions, bags, booking URLs | Deep analysis, programmatic use |

**Summary mode** saves tokens by stripping per-segment details, baggage policies, and booking conditions. Ask for `response_mode: "full"` on `search_flights` or `get_flight_results` when you need them.

```jsonc
// summary response (search_flights)
{
  "total_offers": 42,
  "offers": [
    { "id": "off_abc", "price": "€29", "airlines": ["FR"], "route": "STN→BCN", "departure": "06:15", "stops": 0 }
  ],
  "hint": "More offers are still landing — call get_flight_results before recommending."
}
```

---

## Starlink Wi-Fi

Offers may carry `starlink`: `confirmed_all` / `confirmed_some` mean the carrier
has **fully** fitted that aircraft type; `likely_all` / `likely_some` mean the
rollout on that type is underway but incomplete. Segments carry `confirmed` or
`likely`.

Only `confirmed_*` is safe to state as fact — `likely_*` is a signal, not a
promise. Anything ending `_some` has at least one leg without it. An **absent**
field means no information, **not** an absence of Wi-Fi.

Full semantics: [docs/api-search.md](https://github.com/LetsFG/LetsFG/blob/main/docs/api-search.md#starlink-wi-fi).

## Get an API Key (Developer API only)

Most agents do not need this: the card-backed token from letsfg.co/connect
already searches and books. An API key belongs to the separate, paid,
prepaid-balance Developer API. If that is what you want, register at
[letsfg.co/developers](https://letsfg.co/developers) or via CLI:

```bash
pip install letsfg
letsfg register --name my-agent --email you@example.com
```

Or directly via the API:

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-agent", "email": "agent@example.com"}'
```


---

## Architecture & Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│  MCP Client  (Claude Desktop / Cursor / Windsurf / etc.)     │
│     ↕ stdio (JSON-RPC)                                       │
├──────────────────────────────────────────────────────────────┤
│  letsfg-mcp  (this package, runs on YOUR machine)            │
│     │                                                        │
│     └─→ HTTPS to letsfg.co (all search + booking)           │
│           search, book (hold → agent → PNR)                  │
└──────────────────────────────────────────────────────────────┘
```

All search and booking run server-side at letsfg.co. No local browsers or scrapers are involved. Connect a card once at letsfg.co/connect (0.00 Revolut setup, nothing charged) and the token is card-backed for search and booking.

### What data goes where

| Operation | Where data flows | What is sent |
|-----------|-----------------|--------------|
| `search_flights` | Your machine → letsfg.co → airlines + GDS providers | Route, date, passenger count |
| `resolve_location` | Your machine → letsfg.co | City/airport name |
| `book_flight` | Your machine → letsfg.co → LetsFG booking agent → seller | Passenger name, DOB, nationality, email, phone, address; the hold goes to Revolut |
| `get_flight_booking` | Your machine → letsfg.co | booking_ref |
| `connect_payment` | Your machine → letsfg.co (Developer API only) | Nothing but your API key; the card is entered by a person on the returned page |

---

## Security & Privacy

- **TLS everywhere** — all communication uses HTTPS. The server-side engine connects to airline websites over HTTPS.
- **No card storage** — the card is saved with Revolut at letsfg.co/connect. LetsFG never sees or stores raw card numbers.
- **API key scoping** — `LETSFG_API_KEY` grants access only to your agent's account. Keys are prefixed `letsfg_` for easy identification and revocation.
- **PII handling** — passenger names, emails, and DOBs are sent to the airline for booking (required by airlines). LetsFG does not store passenger PII after forwarding to the airline.
- **No tracking** — no cookies, no session-based pricing, no fingerprinting. Every search returns the same price.
- **Open source** — the SDK and MCP server code is MIT-licensed and auditable at [github.com/LetsFG/LetsFG](https://github.com/LetsFG/LetsFG).

---

## Sandbox / Test Mode

Search costs nothing, so develop against real results. `book_flight` places a
real hold on a real card; there is no test card on the PFS lane. The paid
Developer API has a keyless sandbox — see
[docs/api-sandbox.md](https://github.com/LetsFG/LetsFG/blob/main/docs/api-sandbox.md).

---

## FAQ

### `spawn npx ENOENT` on Windows

Windows can't find `npx` in PATH. Use the full path:
```json
"command": "C:\\Program Files\\nodejs\\npx.cmd"
```
Or install globally and use `node` directly (see Windows config above).

### HTTP 403 with an anti-bot challenge page (VPS / datacenter hosts)

If a tool returns `HTTP 403 … an anti-bot challenge page was returned instead of the API`,
the request never reached the search engine — something in the network path in front of
`letsfg.co` answered it, and no token can get past that. It is seen from datacenter and
VPS IPs, which is where MCP servers normally run.

**Upgrade first: `2026.5.74` and later send a declared-bot User-Agent that is not singled
out this way** (`Mozilla/5.0 (compatible; letsfg-mcp/1.3.1; +https://github.com/LetsFG/LetsFG)`).
If you pinned an older version, that is the likeliest cause.

If it still happens, override the User-Agent yourself:

```json
"env": {
  "LETSFG_BEARER_TOKEN": "eyJ...",
  "LETSFG_USER_AGENT": "Mozilla/5.0 (compatible; letsfg-mcp)"
}
```

Please also open an issue with your host and egress IP — the durable fix belongs on our
side, not in your config.

### Search returns 0 results

- Check IATA codes are correct — use `resolve_location` first
- Try a date 2+ weeks in the future (airlines don't sell last-minute on all routes)
- Connect a card through the hosted MCP if you haven't yet — a valid card-backed token is required for free search (`LETSFG_BEARER_TOKEN` for the stdio server)

### How do I get free search without a Developer API key?

Connect LetsFG as an MCP server at `https://letsfg.co/developers/api/mcp` and approve it; the consent step opens letsfg.co/connect, where you add a card in a 0.00 Revolut setup. Nothing is charged and there is no authorization hold. The token you get is card-backed and works for `POST /api/search` and `POST /api/agent-book`. Tokens from the old `letsfg auth` (Stripe) flow were revoked on 2026-09-02 — reconnect.

### Can my agent actually book, or just search?

Book. `book_flight` does what the website checkout does: the fare is held on the connected card, a LetsFG booking agent buys the ticket, and the hold is captured only once a real airline PNR exists — for every offer, not just one supplier. Poll `get_flight_booking` until `completed`; a `failed` booking releases the hold and charges nothing.

### Can I use this for commercial projects?

Yes. MIT license. The SDK, MCP server, and ranking engine are fully open source.

### MCP server hangs on start

Ensure Node.js 18+ is installed. The server communicates via stdio (stdin/stdout JSON-RPC) — it doesn't open a port or print a "ready" message. MCP clients handle the lifecycle automatically.

---

<details>
<summary><strong>Airlines covered — sample list</strong></summary>

| Region | Airlines |
|--------|----------|
| **Europe** | Ryanair, Wizz Air, EasyJet, Norwegian, Vueling, Eurowings, Transavia, Pegasus, Turkish Airlines, Condor, SunExpress, Volotea, Smartwings, Jet2, LOT Polish Airlines, Finnair, SAS, Aegean, Aer Lingus, ITA Airways, TAP Portugal, Icelandair, PLAY |
| **Middle East & Africa** | Emirates, Etihad, Qatar Airways, flydubai, Air Arabia, flynas, Salam Air, Air Peace, FlySafair, EgyptAir, Ethiopian Airlines, Kenya Airways, Royal Air Maroc, South African Airways |
| **Asia-Pacific** | AirAsia, IndiGo, SpiceJet, Akasa Air, Air India, Air India Express, VietJet, Cebu Pacific, Scoot, Jetstar, Peach, Spring Airlines, Lucky Air, 9 Air, Nok Air, Batik Air, Jeju Air, T'way Air, ZIPAIR, Singapore Airlines, Cathay Pacific, Malaysian Airlines, Thai Airways, Korean Air, ANA, JAL, Qantas, Virgin Australia, Bangkok Airways, Air New Zealand, Garuda Indonesia, Philippine Airlines, US-Bangla, Biman Bangladesh |
| **Americas** | American Airlines, Delta, United, Southwest, JetBlue, Alaska Airlines, Hawaiian Airlines, Sun Country, Frontier, Volaris, VivaAerobus, Allegiant, Avelo, Breeze, Flair, GOL, Azul, JetSmart, Flybondi, Porter, WestJet, LATAM, Copa, Avianca, Air Canada, Arajet, Wingo, Sky Airline |
| **Aggregator** | Kiwi.com (virtual interlining + LCC fallback) |

</details>

---

## Also Available As

- **JavaScript/TypeScript SDK + CLI**: `npm install letsfg` — [npm](https://www.npmjs.com/package/letsfg)
- **Python SDK + CLI**: `pip install letsfg` — [PyPI](https://pypi.org/project/letsfg/)
- **Try without installing**: [Message us on Messenger](https://m.me/61579557368989)
- **GitHub**: [LetsFG/LetsFG](https://github.com/LetsFG/LetsFG)

> ⭐ **[Star the repo](https://github.com/LetsFG/LetsFG)** — we appreciate the support.

## License

MIT

## 🏨 Hotels — new, and live

Your agent can now book hotels, not just flights. Same API key, same connected payment method.

> **Update your SDK before booking hotels.** Hotel booking needs **letsfg 2026.5.101** or later (Python),
> **letsfg 2026.5.74** or later (JavaScript/TypeScript) or **letsfg-mcp 2026.5.77** or later. Earlier releases send
> the reservation-fee fields retired on 2026-09-11 (`expected_balance`, no `expected_cost`), and the API refuses
> every hotel booking they make. Update with `pip install -U letsfg`, `npm install letsfg@latest` or
> `npx -y letsfg-mcp@latest`. The hosted MCP at `https://letsfg.co/developers/api/mcp` needs no update.

```python
from letsfg import LetsFG
lfg = LetsFG()

city = lfg.hotel_destinations("Warsaw")[0]
stays = lfg.search_hotels(
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12", adults=2,
)

hotel = stays["hotels"][0]
offer = hotel["offers"][0]
print(hotel["name"], offer["price"], offer["currency"], offer["refundable"])
# prices are in stays["currency"]: USD unless you pass currency=

booking = lfg.book_hotel_and_wait(
    session_id=offer["session_id"],
    hotel_code=hotel["hotel_code"],
    combination_id_v2=offer["combination_id_v2"],
    expected_price=offer["price"],          # copy these four from the offer, verbatim
    expected_cost=offer["expected_cost"],
    currency=offer["currency"],
    fx_rate=offer["fx_rate"],
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12",
    # ONE entry per guest in the room, children included: adults first, then children in child_ages order
    guests=[{"title": "Mr", "first_name": "Jan", "last_name": "Kowalski"},
            {"title": "Mrs", "first_name": "Anna", "last_name": "Kowalska"}],
    email="GUEST_EMAIL", phone="512345678",   # the guest's real e-mail and phone
)
if booking["status"] == "succeeded":
    print(booking["confirmation"], booking["total_price"], booking["currency"])
elif booking["status"] == "failed":
    print("Not booked, nothing charged:", booking["error"])
else:  # "attention": a person is checking it with the supplier, the hold is kept. Do not book again.
    print(booking["status"], booking.get("error"))
```

### How you pay

**The full price is held, and taken only once the hotel confirms.** Booking holds the offer's
`price` on the Revolut payment method connected to your account — authorised, not charged.
LetsFG then books the room with the supplier and pays the supplier itself. The hold is captured
only after the supplier has confirmed the booking; if the booking fails for any reason (the rate
is gone, the price moved, the supplier declined, a guest detail was rejected), the hold is
released and nothing is charged.

There is **no reservation fee, no deposit and no pay link**, and the guest owes the hotel nothing
further. (Those belonged to the process retired on 2026-09-11.)

`price` is what the guest pays. Nothing is added at booking. Prices are in the currency you search in:
USD unless you ask for another.

Cancelling a refundable rate before its `free_cancellation_until` costs nothing and refunds the
charge in full. A cancellation that would cost money is refused (409); the hotel's own ladder is in
the booking's `terms`.

### What search costs

Search is metered separately from booking, on **either** auth path (free PFS
Bearer token or Developer API key — both count against the same agent):
**the first 1,000 `search_hotels` calls since your last hotel booking are
free.** Past that, searches are billed in blocks of 1,000 for **$5**
(~$0.005/search) from your prepaid balance — refused with a 402 if the
balance can't cover the next block, never silently allowed. Book a hotel
and the count resets to zero. Resolving a city name (`resolve_hotel_city`)
is not metered, only the search call itself.

### Things worth knowing before you build

- **A connected payment method is required for every hotel call, including search.** A hotel
  search opens a real session at the supplier and booking blocks a real rate, so we refuse up
  front rather than let you reach the point of commitment and discover you cannot pay. The same
  method authorises flights and hotels — there is no separate hotel signup.
- **Every rate type is sold**, refundable and non-refundable. Each offer's `refundable` and
  `free_cancellation_until` say which one you are buying.
- **Booking is asynchronous.** `book_hotel` returns a `booking_job_id`, not a booking — the real
  thing takes minutes. Poll `hotel_booking(job_id)` every ~20 s until `status` is `succeeded`,
  `failed` or `attention`, or call `book_hotel_and_wait` and let the SDK do it. All three are final:
  - `succeeded` — `confirmation`, `total_price` + `currency` (what the guest is charged),
    `supplier_paid` + `supplier_currency`, `refundable`, `free_cancellation_until`,
    `cancellation_ladder` and `terms`.
  - `failed` — `error`, written for the guest. The hold has been released; nothing was charged.
  - `attention` — the outcome could not be settled automatically. The hold is kept (nothing is
    charged) while a person checks with the supplier. Do not book again.
- **Copy the offer verbatim.** Send `expected_price` (the offer's `price`), `expected_cost`,
  `currency` and `fx_rate` exactly as search returned them. A mis-copied price, or a USD offer sent
  without its `currency`, is refused with `400 price_mismatch` before anything is held.
- **Guest details are checked before anything is held**: Latin-script names, a phone number valid
  for its country code, and an e-mail. A problem returns `400 invalid_details` naming the fields.
- **One name per guest in the room, children included.** For a family, search with `children` and
  `child_ages`; the party travels with the offer's session. `guests` then lists every guest — adults
  first, then children in `child_ages` order. The hotel requires a name for every guest: fewer names
  than guests is refused before anything is submitted, and the hold is released.
- **The guest is e-mailed however it ends**: a confirmation with the code and the cancellation
  term, a note that it did not go through and nothing was charged, or a note that it is being
  confirmed with the supplier.
- **A retry never books twice.** A second `book_hotel` for the same rate and guest returns the job
  already under way (`duplicate: true`); pass `idempotency_key` to make that explicit. Still, never
  re-post a booking whose job is running — poll it.

### JavaScript

```javascript
import { LetsFG } from 'letsfg';
const lfg = new LetsFG({ apiKey: process.env.LETSFG_API_KEY });

const [city] = await lfg.hotelDestinations('Warsaw');
const stays = await lfg.searchHotels({
  cityId: city.Id, cityName: city.Name,
  checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2,
});

const hotel = stays.hotels[0];
const offer = hotel.offers[0];
const booking = await lfg.bookHotelAndWait({
  sessionId: offer.session_id, hotelCode: hotel.hotel_code,
  combinationIdV2: offer.combination_id_v2,
  expectedPrice: offer.price, expectedCost: offer.expected_cost,
  currency: offer.currency, fxRate: offer.fx_rate,
  cityId: city.Id, cityName: city.Name,
  checkIn: '2026-11-10', checkOut: '2026-11-12',
  // ONE entry per guest in the room, children included: adults first, then children in childAges order
  guests: [{ title: 'Mr', first_name: 'Jan', last_name: 'Kowalski' },
    { title: 'Mrs', first_name: 'Anna', last_name: 'Kowalska' }],
  email: 'GUEST_EMAIL', phone: '512345678',
});
console.log(booking.status, booking.confirmation, booking.total_price, booking.currency);
```

### MCP

Five new tools, in the order you call them: `resolve_hotel_city` →
`search_hotels` → `book_hotel` → `get_hotel_booking` → `cancel_hotel_booking`.

