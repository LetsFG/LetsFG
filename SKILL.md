---
name: letsfg
description: "LetsFG — Agent-native flight and hotel search and booking API. Hundreds of airlines plus the major booking sites (Google Flights, Skyscanner, Kiwi, Kayak, Momondo), with per-flight reliability history and instant booking. Plus real bookable hotel rates, refundable and non-refundable: the price is held on the connected card and charged only once the hotel confirms. letsfg.co"
---

# SKILL.md — LetsFG Capabilities

> **MPP:** a card-free *enrolment* lane for agents holding a Tempo wallet is
> offered only when the `402` from `POST /api/agent-access/request` carries an
> `mpp` object. It costs **$0.01 once**, as verification only. Search stays free
> and booking costs the price on the offer. Earlier revisions of this page
> described an MPP charge at *unlock* time; that never shipped. See
> <https://letsfg.co/for-agents>.

> ### ⚠️ Agents: do not create a Developer API account
>
> Do **NOT** call `/developers/api/v1/agents/register` or
> `/developers/api/v1/agents/connect-payment`, and do **NOT** run
> `letsfg register` or `letsfg connect-payment`. Those belong to a separate,
> paid, prepaid-balance product for high-volume commercial integrations and
> create a billing account you almost certainly do not want.
>
> To search and book flights, connect LetsFG as an MCP server at
> `https://letsfg.co/developers/api/mcp` and approve it — the consent step saves
> a card at <https://letsfg.co/connect> (nothing charged). Then search and book.
> See <https://letsfg.co/for-agents>.

> Machine-readable skill manifest for AI agents and documentation indexers.
## Identity

- **Name:** LetsFG
- **Type:** API + SDK + MCP Server + CLI
- **Purpose:** Agent-native flight and hotel search and booking
- **Compatible agents:** OpenClaw, Perplexity Computer, Claude Desktop, Cursor, Windsurf, and any MCP-compatible client
- **API Base URL:** `https://letsfg.co/developers/api/v1`
- **MCP Endpoint:** `https://letsfg.co/developers/api/mcp` (Streamable HTTP)
- **Packages:** PyPI `letsfg` · npm `letsfg` · npm `letsfg-mcp`
- **License:** MIT

## Access Modes

| Mode | Best for | Speed | Cost |
|------|----------|-------|------|
| **MCP / SDK / CLI** (PFS card-backed token) | **Almost every agent.** Search + booking | 8–10 s to first results | Free auth, free search, booking at the price on the offer |
| **Developer API** (`https://letsfg.co/developers`) | Business / commercial / high-volume (hotels work on either credential) | 2–5 s (discover) · 8–10 s to first results (full search) | Look-to-book: 200 searches free after every booking, then $0.01. Booking via `POST /flights/book`, no booking fee, no transaction fee |

## Skills

### search_flights
Search hundreds of airlines AND the major booking sites (Google Flights, Skyscanner, Kiwi, Kayak, Momondo) in one call. Returns real-time prices plus per-flight reliability history.
- **Cost:** FREE (unlimited)
- **Input:** origin (IATA), destination (IATA), date_from, optional: date_to, return_from, return_to, adults, children, infants, cabin_class (M/W/C/F), max_stopovers, currency, sort, limit
- **Output:** List of flight offers with price, airlines, times, segments, conditions, passenger_ids
- **Note:** On PFS (Bearer token), call `book_flight` directly — no unlock step — then poll `get_flight_booking`. The Developer API has no unlock step either: book with `POST /flights/book` and poll `GET /flights/bookings/{id}`.
- **Rate limit (PFS):** 10 searches per 10 min, 30 per hour, 100 per day, per card. Polling results never counts.

### resolve_hotel_city
Resolve a place name to the supplier city id that hotel search needs.
- **Cost:** FREE (a card must still be on file)
- **Endpoint:** `POST /api/v1/hotels/destinations`
- **Input:** text (place name, e.g. "Warsaw")
- **Output:** Matches, best first. Use `Id` as city_id and `Name` as city_name.

### search_hotels
Search real, bookable hotel inventory.
- **Cost:** FREE, but a payment method on file is REQUIRED — for search, not just booking. A hotel
  search opens a real session at the supplier, so it returns HTTP 402 without a card.
- **Auth:** Either a Developer API key (`X-API-Key`) or the PFS card-backed token from the connect flow. The same card authorises flights and hotels.
- **Endpoint:** `POST /api/v1/hotels/search`
- **Input:** city_id, city_name, check_in, check_out, adults, children, child_ages, nationality, currency (USD by default), limit
- **Output:** hotels[] each with offers[] carrying `price` (the all-in total the guest pays, in
  `currency`), `fx_rate`, `expected_cost`, `refundable`, `free_cancellation_until` (refundable
  rates only), `cancellation_policy`, `combination_id_v2` and `session_id`
- **Note:** Every rate type is sold, refundable and non-refundable — show `refundable` and
  `free_cancellation_until` before booking. Keep the chosen offer's `session_id` and
  `combination_id_v2`; booking needs both. `price` is the supplier's cost plus 6.4% (8.3% on a
  card issued outside the EEA; `markup_rate` says which).
- **Allowance:** 1,000 hotel searches free after every hotel booking, then blocks of 1,000 for
  $5.00 from prepaid balance.

### search_transfers
Search ground transfers — private cars, taxis, shared shuttles, airport express.
- **Cost:** FREE
- **Input:** origin, destination, date, passengers
- **Output:** Transfer options with prices and vehicle types

### search_activities
Search activities — tours, museum tickets, day trips via direct APIs and aggregators.
- **Cost:** FREE
- **Input:** location, date_from, date_to
- **Output:** Activity options with prices, descriptions, availability

### resolve_location
Resolve city names to IATA airport/city codes.
- **Cost:** FREE
- **Input:** query (city name, e.g. "London")
- **Output:** List of matching IATA codes (e.g. LON, LHR, LGW, STN, LTN, LCY)

### unlock_flight_offer
**RETIRED 2026-09-08 — the route answers `410 Gone`.**
- There is no unlock step on either lane. Booking holds the fare and captures only against a real PNR, which is what unlock existed to protect against. Call `/api/agent-book` (PFS) or `POST /flights/book` (Developer API) instead.
- **Endpoint:** `POST /api/v1/bookings/unlock` — answers `410 Gone`, and the SDKs' `unlock()` fails the same way.

### book_flight
Book an offer.
- **PFS (Bearer token):** `POST /api/agent-book`. No unlock step — search, then book directly.
  Works for every offer in the results, whichever seller it came from. Exactly what the website
  checkout does: the fare plus LetsFG's markup is **held** on the connected card (not taken), a
  LetsFG booking agent buys the ticket from the seller, and the hold is captured only once a real
  airline PNR exists. If the booking fails the hold is released and nothing is charged.
  - **Input:** `search_id` + `offer_id` exactly as search returned them (offers expire ~15 min),
    `contact_email`, and ONE `passenger` per call: given_name, family_name, born_on, gender (m/f),
    nationality (ISO-2), phone_number + phone_country, address_line1, address_city,
    address_postal, address_country; passport_number/country/expiry optional.
  - **Output (seconds):** `{"state": "booking_in_progress", "booking_ref": "eyJ...",
    "held": {"amount": 93, "currency": "EUR", "card": "visa ending 5709"}, "charged": 0}`.
    The booking itself takes 4–11 minutes — poll `get_flight_booking`.
  - **Nothing charged on:** `{"error": "missing_details", "missing_fields": [...]}` (ask, call again),
    `payment_method_required` and `payment_declined` (both carry `add_card_url`: https://letsfg.co/connect).
  - Never call it twice for the same trip while one is in progress — that places a second hold.
  - **CLI:** `letsfg book ws_off_xxx --search-id ws_xxx --passenger '{...}' --email you@example.com`
  - **Python:** `bt.book(offer_id=..., passengers=[{...}], contact_email=..., search_id=...)`
- **Developer API:** `POST /api/v1/flights/book`. The same flow with no unlock step: the fare is held
  on the connected Revolut method, a LetsFG booking agent buys the ticket, and the hold is captured
  only against a real airline PNR. No booking fee, no transaction fee.
  - **Prerequisite:** a Revolut method connected with `POST /api/v1/agents/connect-payment` (nothing is charged to connect).
  - **Input:** search_id, offer_id, passengers (given_name, family_name, born_on, gender, email, phone_number, nationality, ...), contact_email, idempotency_key
  - **Output:** `202` with `booking_id`, `held`, `charged: 0` and `poll_url`. Poll `GET /api/v1/flights/bookings/{booking_id}` until `terminal`: `completed` (`pnr`, `charged_amount`) | `failed` (hold released, nothing charged) | `needs_attention`.
- **CRITICAL (both paths):** Use real passenger names (must match passport/ID) and real email (airline sends e-ticket there).

### get_flight_booking
Where a booking started by `book_flight` has got to (PFS). `POST /api/agent-book/status {"booking_ref": "eyJ..."}`.
- **Cost:** FREE. Poll every 20–30 s.
- **States:** `booking_in_progress` (the agent is at the seller's checkout — keep waiting) →
  `completed` (`pnr`, `charged_amount`, `currency` — booked) | `failed` (`failure_reason`; the hold was
  released, nothing charged) | `needs_attention` (a human at LetsFG is checking it — do NOT book again;
  the traveller will be emailed). `updated_at_ms` says when it last moved.
- Only `completed` with a PNR means booked.

### book_hotel
Start a hotel booking. Returns a job, NOT a booking.
- **Cost:** the offer's `price`. It is **held** on the connected card (not taken), LetsFG books the
  room and pays the supplier, and the hold is captured only once the hotel confirms. A failed
  booking releases the hold. No reservation fee, no deposit, no pay link.
- **Endpoint:** `POST /api/v1/hotels/book`
- **Input:** session_id (the chosen offer's), hotel_code, combination_id_v2, expected_price,
  expected_cost, currency, fx_rate, city_id, city_name, check_in, check_out, adults,
  guests[{title, first_name, last_name}], email, phone; optional phone_country_code,
  special_requests, idempotency_key
- **Output:** booking_job_id, booking_id, status "in_progress", the amount held, poll URL
- **Asynchronous:** a real booking takes minutes — the rate is re-blocked at the supplier, the room
  committed and paid. Poll `get_hotel_booking` until status is `succeeded`, `failed` or `attention`.
- **CRITICAL:** send `expected_price`, `expected_cost`, `currency` and `fx_rate` back exactly as the
  chosen offer returned them, or the booking is refused as `price_mismatch` — a guest is never
  charged a price they did not agree to. There is no `expected_balance`.
- **CRITICAL:** never call this again while its job is running — poll the job. A retry with the same
  `idempotency_key` returns the existing job instead of booking twice.
- **Note:** guest names, phone and e-mail are checked before anything is held (`400 invalid_details`).
- **CRITICAL:** `guests` needs a name for every person in the room, children included: adults first,
  then children in `child_ages` order. Fewer names than the searched party fails the booking before
  anything reaches the hotel, and the hold is released.

### get_hotel_booking
Collect the result of a booking started with `book_hotel`.
- **Cost:** FREE
- **Endpoint:** `GET /api/v1/hotels/booking/{booking_job_id}`
- **Output:** status — `in_progress`, then `succeeded` (confirmation, total_price + currency = what
  the guest is charged, refundable, free_cancellation_until, terms with the full cancellation
  ladder) | `failed` (`error`; the hold was released, nothing charged) | `attention` (`error`; a
  person at LetsFG is confirming the outcome with the supplier, the hold is kept — do NOT book again)
- **Note:** the guest is e-mailed however the booking ends.

### cancel_hotel_booking
Release a hotel reservation.
- **Cost:** Free on a refundable rate before `free_cancellation_until` — the charge is refunded in
  full. A cancellation the hotel would charge for (a non-refundable rate, or past that date) is
  refused with `409`; the hotel's own ladder is in the booking's `terms`.
- **Endpoint:** `POST /api/v1/hotels/cancel`
- **Input:** confirmation (only your own bookings)
- **Output:** confirmation, charge, refund
- **Note:** drives a browser at the supplier and takes over a minute. If it times out, do NOT
  assume it failed — re-check before retrying.

### register
Register a new AI agent.
- **Cost:** FREE
- **Input:** agent_name, email
- **Output:** api_key (permanent credential)

### connect_payment
**Developer API only.** `POST /api/v1/agents/connect-payment` returns a one-time `connect_url`; a
person opens it in a browser and saves a card or Revolut Pay. Agents on the PFS lane do not call
this — their card is saved at <https://letsfg.co/connect> during the MCP connect step.
- **Cost:** FREE — nothing is charged to connect
- **Output:** `connect_url` (valid for one hour)
- **Note:** `setup_payment` (`POST /agents/setup-payment`) was retired with Stripe on 2026-09-08
  and answers `410 Gone`.

### get_agent_profile
Get current agent's profile, usage stats, and payment status.
- **Cost:** FREE
- **Output:** Agent details, search count, booking count, payment status

## Authentication

**PFS (recommended — almost every agent):** a card-backed Bearer token. Nothing
is charged to connect: the card is saved in a 0.00 Revolut setup at
<https://letsfg.co/connect> (any card, or Revolut Pay / Google Pay; no Revolut
account needed; card details never touch LetsFG). Search, flight booking and
hotels all work with it.

```
Authorization: Bearer eyJ...
```

Get a token — the one way in:

1. Add LetsFG as a remote MCP server: `https://letsfg.co/developers/api/mcp`.
2. Approve the connection. The OAuth consent step opens
   <https://letsfg.co/connect>, where the person adds a card or pays 0.00 with
   Revolut Pay / Google Pay.
3. The OAuth token you receive is card-backed. Over the MCP it is carried for
   you; over raw HTTP send it as `Authorization: Bearer <token>`.

`POST /api/agent-access/request` answers `402` with these steps as JSON
(`add_card_url`, `how`). The Stripe enrolment lanes (`setup_url`, `setup_intent`,
`card_token`) were retired on 2026-09-02 and every token they issued was revoked
(`401 TOKEN_REVOKED`; `/api/agent-access/verify` answers `410` for a Stripe
credential) — reconnect at letsfg.co/connect. `letsfg auth` (npm or PyPI) now
drives that connect flow from the terminal and stores the token; the CLI and
SDKs otherwise read it from `LETSFG_BEARER_TOKEN`. One card = one account; quotas are per card. Full flow:
<https://letsfg.co/for-agents>.

**Developer API (business / high-volume):** every endpoint except `register`
requires an `X-API-Key` header.

```
X-API-Key: letsfg_...
```

Get your key by calling `POST /api/v1/agents/register` with agent_name and email. The key is permanent — save it once.

Then connect a payment method with `POST /api/v1/agents/connect-payment` and open the returned `connect_url` once (nothing is charged).

## Complete Workflow

### Flight Booking — PFS (3 API calls)

```
1. POST /api/search                    → Search flights (FREE), returns search_id; poll GET /api/results/{search_id}
2. POST /api/agent-book                → Book directly — no unlock step. Holds the fare on the connected card, returns booking_ref in seconds
3. POST /api/agent-book/status         → Poll every 20–30 s (4–11 min) → completed (PNR) | failed (hold released) | needs_attention
```

### Flight Booking — Developer API (5 API calls)

```
1. POST /api/v1/agents/register          → Get API key (once)
2. POST /api/v1/agents/connect-payment   → Open the connect_url once to save a card (nothing charged)
3. POST /api/v1/flights/search           → Search flights (look-to-book: 200 free after every booking)
4. POST /api/v1/flights/book             → Hold the fare, dispatch the booking agent → booking_id (202)
5. GET  /api/v1/flights/bookings/{id}    → Poll until terminal → completed (PNR) | failed (hold released) | needs_attention
```

### Hotel Booking (PFS Bearer token or Developer API key — the same card authorises both)

```
1. Card on file                            → PFS: saved at letsfg.co/connect; Developer API: POST /api/v1/agents/connect-payment. Required for SEARCH too
2. POST /api/v1/hotels/destinations        → Place name → city_id
3. POST /api/v1/hotels/search              → Bookable rates (card required; 1,000 free after every hotel booking)
4. POST /api/v1/hotels/book                → Holds the price; returns booking_job_id — NOT a booking
5. GET  /api/v1/hotels/booking/{job_id}    → Poll ~20s until succeeded / failed / attention
                                             → confirmation + total_price + currency
6. POST /api/v1/hotels/cancel              → Optional; free on a refundable rate before free_cancellation_until
```

The full price is held on the card at step 4 and captured only once the hotel confirms; a failed
booking releases the hold. There is no reservation fee, no deposit and no pay link. Never repeat
step 4 while its job is running — poll it.

## CLI Usage

```bash
pip install letsfg

export LETSFG_BEARER_TOKEN=eyJ...   # card-backed token from the connect flow (see Authentication)

# Search flights — prints search_id, needed for book
letsfg search LHR JFK 2026-04-15
letsfg search LON BCN 2026-04-01 --return 2026-04-08 --cabin C --sort price
letsfg search GDN BER 2026-05-10 --adults 2 --children 1

# Resolve locations
letsfg locations "New York"

# Book — price shown on the offer, no unlock step. Holds the fare on the connected
# card and prints a booking_ref; poll POST /api/agent-book/status every 20–30 s
letsfg book ws_off_xxx --search-id ws_xxx \
  --passenger '{"given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m","nationality":"GB","phone_number":"+447123456789","phone_country":"GB","address_line1":"1 High St","address_city":"London","address_postal":"N1 9GU","address_country":"GB"}' \
  --email john.doe@example.com

# Machine-readable output
letsfg search GDN BER 2026-03-03 --json
```

Developer API instead? `letsfg register` + `letsfg connect-payment` once (open the link it
prints), then `letsfg search ... --api-key letsfg_...` and
`letsfg book off_xxx --search-id <search_id> --api-key letsfg_... --passenger '{...}' --email ...`.
No unlock step.

## Python SDK Usage

```python
from letsfg import LetsFG

bt = LetsFG()  # reads LETSFG_BEARER_TOKEN — the card-backed token from the connect flow

# Search
results = bt.search("LHR", "JFK", "2026-04-15")
for offer in results.offers:
    print(f"{offer.price} {offer.currency} — {', '.join(offer.airlines)}")

# Book — price shown on the offer, no unlock step. Holds the fare on the
# connected card; a LetsFG agent buys the ticket; captured only on a real PNR.
result = bt.book(
    offer_id=results.offers[0].id,
    passengers=[{
        "given_name": "John", "family_name": "Doe",
        "born_on": "1990-01-15", "gender": "m", "nationality": "GB",
        "phone_number": "+447123456789", "phone_country": "GB",
        "address_line1": "1 High St", "address_city": "London",
        "address_postal": "N1 9GU", "address_country": "GB",
    }],
    contact_email="john@example.com",
    search_id=results.search_id,
)
if "missing_fields" in result:
    print("Nothing charged — ask for:", result["missing_fields"])
else:
    print("Started:", result["booking_ref"], result["held"])
    # poll POST /api/agent-book/status {"booking_ref": ...} every 20–30 s
    # until state is completed (pnr) | failed (hold released) | needs_attention
```

Developer API instead? `LetsFG(api_key="letsfg_...")`, then `bt.book(offer_id, passengers,
contact_email, search_id=..., idempotency_key=...)` — no unlock step. It starts the booking; poll
it with `bt.get_booking(booking_id)`, or call `bt.book_and_wait(...)` to block until it settles.

## MCP Server Setup

**Remote (Streamable HTTP) — the way in for agents:**

```json
{
  "mcpServers": {
    "letsfg": { "url": "https://letsfg.co/developers/api/mcp" }
  }
}
```

Claude Code: `claude mcp add --transport http letsfg https://letsfg.co/developers/api/mcp`.
claude.ai / ChatGPT: add a custom connector with that URL. Windsurf uses
`"serverUrl"` instead of `"url"`. The client runs OAuth; the consent step opens
<https://letsfg.co/connect> where the person saves a card (0.00, nothing
charged). The token the client receives is card-backed and can search and book.
Developer API accounts can use the same URL with
`"headers": {"X-API-Key": "letsfg_..."}` instead of OAuth.

**Local (stdio) — needs a token you already hold:**

```bash
npm install -g letsfg-mcp
LETSFG_BEARER_TOKEN=eyJ...  letsfg-mcp   # card-backed token from the connect flow
```

The local server also accepts `LETSFG_API_KEY` instead, for the Developer API.
`book_flight` dispatches automatically based on which one is set. Its
`authenticate` tool returns the current connect instructions (`add_card_url`,
`how`); run `letsfg auth` to mint a token from the terminal.

## MCP Tools

| Tool | Description | Cost |
|------|-------------|------|
| `search_flights` | Search hundreds of airlines via server-side engine | FREE |
| `resolve_location` | City name → IATA code | FREE |
| `book_flight` | Start a booking. PFS: direct, no unlock step — holds the fare on the connected card, returns `booking_ref`. Developer API key: the same call, no unlock step | Price shown on the offer, no separate LetsFG fee (PFS) |
| `get_flight_booking` | Poll a PFS booking every 20–30 s: `booking_in_progress` → `completed` (PNR) / `failed` (hold released) / `needs_attention` | FREE |
| `unlock_flight_offer` | **RETIRED 2026-09-08** — answers `410 Gone`. Call `book_flight` directly | — |
| `connect_payment` | **[Developer API only]** Mint a one-time link to connect a card to the paid account (nothing charged). PFS agents connect at letsfg.co/connect instead | FREE |
| `resolve_hotel_city` | Place name → supplier city id for `search_hotels` | FREE (card on file) |
| `search_hotels` | Bookable hotel rates, refundable and non-refundable | FREE (card on file; 1,000 per hotel booking) |
| `book_hotel` | Start a hotel booking: the price is held, captured once the hotel confirms. Returns `booking_job_id` | The price on the offer |
| `get_hotel_booking` | Poll until `succeeded` / `failed` / `attention` | FREE |
| `cancel_hotel_booking` | Cancel a refundable booking before `free_cancellation_until` (refunded in full) | FREE |
| `get_agent_profile` | View usage stats | FREE |

## Search Flags Reference

| Flag | API Field | Values | Default |
|------|-----------|--------|---------|
| `--adults` | `adults` | 1–9 | 1 |
| `--children` | `children` | 0–9 | 0 |
| `--infants` | `infants` | 0–9 | 0 |
| `--cabin` | `cabin_class` | M (economy), W (premium), C (business), F (first) | _(any)_ |
| `--return` | `return_from` | YYYY-MM-DD | — |
| `--max-stops` | `max_stopovers` | 0–4 | 2 |
| `--sort` | `sort` | price, duration | price |
| `--limit` | `limit` | 1–100 | 20 |
| `--currency` | `currency` | EUR, USD, GBP, etc. | EUR |

### Cabin Class Codes Explained

| Code | Class | Description | Typical Use Case |
|------|-------|-------------|------------------|
| `M` | Economy | Standard seating | Budget travel, most bookings |
| `W` | Premium Economy | Extra legroom, priority boarding | Long-haul comfort without business price |
| `C` | Business | Lie-flat on long-haul, lounge access | Corporate travel, 6+ hour flights |
| `F` | First | Private suites, premium dining | Ultra-premium routes (limited airlines) |
| `--json` | — | Output as JSON | — |

## Error Handling

| Exception | HTTP Code | When |
|-----------|-----------|------|
| `AuthenticationError` | 401 | Invalid or missing API key |
| `PaymentRequiredError` | 402 | No payment method connected, or the search allowance is used up |
| `OfferExpiredError` | 410 | Offer no longer available |
| `LetsFGError` | 422 | Invalid request parameters |
| `LetsFGError` | 429 | Too many requests (retry with backoff) |
| `LetsFGError` | 502 | Upstream airline/hotel API error |

### Authentication Failure Recovery

```python
from letsfg import LetsFG
from letsfg.connectors.auth import BearerTokenError

try:
    bt = LetsFG()  # reads LETSFG_BEARER_TOKEN — the card-backed token from the connect flow
    flights = bt.search("LHR", "JFK", "2026-04-15")
except BearerTokenError:
    print("Token expired, revoked or missing — reconnect at https://letsfg.co/connect")
```

Developer API:

```python
from letsfg import LetsFG, AuthenticationError

try:
    bt = LetsFG(api_key="letsfg_...")
    flights = bt.search("LHR", "JFK", "2026-04-15")
except AuthenticationError:
    # API key invalid or expired — re-register, then connect a payment method on the new key
    creds = LetsFG.register("my-agent", "agent@example.com")
    bt = LetsFG(api_key=creds["api_key"])
    print("Open once to connect a card:", bt.connect_payment()["connect_url"])  # nothing is charged
```

### Rate Limit and Timeout Handling

```python
import time
from letsfg import LetsFG, LetsFGError

def search_with_retry(bt, origin, dest, date, max_retries=3):
    for attempt in range(max_retries):
        try:
            return bt.search(origin, dest, date)
        except LetsFGError as e:
            if "429" in str(e) or "rate limit" in str(e).lower():
                time.sleep(2 ** attempt)  # exponential backoff
            elif "timeout" in str(e).lower() or "504" in str(e):
                time.sleep(1)
            else:
                raise
    raise LetsFGError("Max retries exceeded")
```

## Rate Limits

| Endpoint | Rate Limit | Typical Latency |
|----------|-----------|------------------|
| Search flights | No hard limit (billing is the natural governor) | 2–5 s (discover) · 8–10 s to first results (full search) |
| Resolve location | 120 req/min | <1s |
| Book | 10 req/min | 3-10s |
| Search hotels | 30 req/min | 3-10s |
| Register | 5 req/min | <1s |

## Pricing Summary

| Action | Cost |
|--------|------|
| Search (flights, transfers, activities) | **Free** |
| Resolve locations | **Free** |
| Register agent | **Free** |
| Connect a payment method | **Free** — nothing is charged to connect |
| View profile | **Free** |
| Book flight (PFS, no unlock needed) | **The price shown on the offer** — held on the connected card, captured only on a real PNR; no separate LetsFG fee |
| Book flight (Developer API) | **The price shown on the offer** — held, captured only on a real PNR; no booking fee, no transaction fee |
| Hotel search | Free up to 1,000 searches after every hotel booking, then 1,000 for $5.00 |
| Hotel booking | **The price shown on the offer** — held on the connected card, captured only once the hotel confirms. No reservation fee |
| Hotel cancellation | Free on a refundable rate before `free_cancellation_until` (refunded in full); otherwise refused |

## Key Facts

- Hundreds of airlines via server-side engine
- Hotels and activities via direct APIs
- Zero price bias — no demand inflation, no cookie tracking
- Typically cheaper than booking through a single OTA, because it compares airlines and the major booking sites in one pass
- Real airline PNR codes and hotel confirmations
- E-tickets sent directly to passenger email
- Search is always free and unlimited
- PFS (Bearer token): book directly, no unlock step — the fare is held on the connected card, a LetsFG booking agent buys the ticket, captured only once a real PNR exists; failed booking = hold released, nothing charged
- Developer API: `POST /flights/book` — the same hold-then-capture flow, then poll `GET /flights/bookings/{id}`. Search there is look-to-book (200 free after every booking) and there is no booking or transaction fee
- API designed for machines, not browsers
