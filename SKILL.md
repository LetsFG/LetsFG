---
name: letsfg
description: "LetsFG — Agent-native flight and hotel search and booking API. Hundreds of airlines plus the major booking sites (Google Flights, Skyscanner, Kiwi, Kayak, Momondo), with per-flight reliability history and instant booking. Plus real bookable hotel rates — free cancellation and pay-later: hold the room with a small upfront charge, then settle the balance by link up to the hotel's own deadline. letsfg.co"
---

# SKILL.md — LetsFG Capabilities

> **MPP (updated 2026-07-30):** the MPP (Machine Payments Protocol) `402`
> challenge is **live**, as a card-free *enrolment* lane for agents holding a
> Tempo wallet. It costs **$0.01 once**, as verification only — MPP has no
> zero-amount intent, so a card-free rail has to settle something. Search and
> booking stay free. Earlier revisions of this page described an MPP charge at
> *unlock* time; that never shipped. See <https://letsfg.co/for-agents>.

> ### ⚠️ Agents: do not create a Developer API account
>
> Do **NOT** call `/developers/api/v1/agents/register` or
> `/developers/api/v1/agents/setup-payment`, and do **NOT** run
> `letsfg register` or `letsfg setup-payment`. Those belong to a separate,
> paid, prepaid-balance product for high-volume commercial integrations and
> create a billing account you almost certainly do not want.
>
> To search and book flights, run `letsfg auth` — a zero-amount card setup
> (nothing charged), then search and book. See <https://letsfg.co/for-agents>.

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
| **CLI / SDK / MCP** (PFS Bearer token) | **Almost every agent.** Search + booking | 8–10 s to first results | Free auth, free search |
| **Developer API** (`https://letsfg.co/developers`) | Business / commercial / high-volume | 2–5 s (discover) · 8–10 s to first results (full search) | Prepaid credits; direct booking URLs, no per-booking fee |

## Skills

### search_flights
Search hundreds of airlines AND the major booking sites (Google Flights, Skyscanner, Kiwi, Kayak, Momondo) in one call. Returns real-time prices plus per-flight reliability history.
- **Cost:** FREE (unlimited)
- **Input:** origin (IATA), destination (IATA), date_from, optional: date_to, return_from, return_to, adults, children, infants, cabin_class (M/W/C/F), max_stopovers, currency, sort, limit
- **Output:** List of flight offers with price, airlines, times, segments, conditions, passenger_ids
- **Note:** On PFS (Bearer token), call `book_flight` directly — no unlock step. On the Developer API, offers must be unlocked before booking.

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
- **Auth:** Either a Developer API key (`X-API-Key`) or the free PFS token from `letsfg auth`. The same card authorises flights and hotels.
- **Endpoint:** `POST /api/v1/hotels/search`
- **Input:** city_id, city_name, check_in, check_out, adults, children, child_ages, nationality, limit
- **Output:** hotels[] each with offers[] carrying `price` (what the guest pays),
  `reservation_fee_now` (the 5%), `balance_to_supplier`, `balance_due_by`,
  `free_cancellation_until`, `combination_id_v2`
- **Note:** Only free-cancellation, pay-later rates are sold, so the result set is smaller than a
  metasearch and every rate returned can actually be booked. Keep `session_id` and the chosen
  offer's `combination_id_v2` — booking needs both.

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
Confirm live price with airline and reveal the direct booking URL. Reserves the offer for 30 minutes.
- **Developer API only.** There is no unlock step on a PFS Bearer token: call `/api/agent-book` instead. Legacy path — not part of the agent flow.
- **Endpoint:** `POST /api/v1/bookings/unlock`
- **Input:** offer_id from search results (only required parameter)
- **Output:** confirmed_price, confirmed_currency, booking_url, offer_expires_at
- **Prerequisite:** A payment method on file (`setup_payment`) for the Stripe path, or an MPP-capable client for the crypto path.
- **HTTP 402:** No card on file. With MPP support, response carries a `WWW-Authenticate: Payment` challenge — pay via Tempo USDC.e and retry. Otherwise add a card via `setup_payment`.
- **HTTP 410:** Offer expired — airline sold the seats, search again (OfferExpiredError)
- **Note:** confirmed_price may differ from search price (airline prices change in real-time). After unlock, you have 30 minutes to complete the booking. If the window expires, search again (free) and unlock again.
- **Python:** `unlocked = bt.unlock(offer_id)` → returns UnlockResult
- **CLI:** `letsfg unlock off_xxx`
- **JS/TS:** `const unlocked = await bt.unlock(offerId)`

### book_flight
Book an offer.
- **PFS (Bearer token):** `POST /api/agent-book`. No unlock step — search, then book directly. One
  passenger per call. Returns either `{"booked": true, "order_id": ...}` or, when the booking
  genuinely could not complete, `{"booked": false, "booking_url": ...}` — nothing charged either
  way beyond the ticket price. Not a transient error; hand the user `booking_url`, don't retry.
  Requires `search_id` (from the search result) alongside `offer_id`.
  - **CLI:** `letsfg book off_xxx --search-id srch_xxx --passenger '{...}' --email you@example.com`
  - **Python:** `bt.book(offer_id=..., passengers=[{...}], contact_email=..., search_id=...)`
- **Developer API:** Requires `unlock` first. Creates a real airline reservation with PNR code, and
  charges ticket price via Stripe before booking.
  - **Cost:** Ticket price + Stripe processing fee (2.9% + 30¢).
  - **Prerequisite:** Payment method must be attached via `setup_payment` first.
  - **Input:** offer_id, passengers (id, given_name, family_name, born_on, gender, title, email, phone_number), contact_email
  - **Output:** booking_reference (airline PNR), status, flight_price, currency
  - **Payment flow:** Your Stripe card is charged the ticket price → LetsFG books via the airline → you get the PNR. If the airline booking fails, you are automatically refunded.
- **CRITICAL (both paths):** Use real passenger names (must match passport/ID) and real email (airline sends e-ticket there).

### book_hotel
Start a hotel booking. Returns a job, NOT a booking.
- **Cost:** 5% of the price charged immediately to the card on file as a NON-REFUNDABLE
  reservation fee. The balance is paid directly to the supplier through the returned `pay_link`.
- **Endpoint:** `POST /api/v1/hotels/book`
- **Input:** session_id, hotel_code, combination_id_v2, expected_price, expected_balance, city_id,
  city_name, check_in, check_out, adults, guests[{title, first_name, last_name}], email, phone
- **Output:** booking_job_id, status "in_progress", poll URL
- **Asynchronous:** a real booking takes minutes — the rate is re-blocked at the supplier, the card
  charged, the room committed. Poll `get_hotel_booking` until status is `succeeded` or `failed`.
  This is what makes it impossible to charge a card and then lose the confirmation to a timeout.
- **CRITICAL:** send `expected_price` and `expected_balance` back exactly as search returned them,
  or the booking is refused as a price mismatch — a guest is never charged a price they did not
  agree to.
- **CRITICAL:** NOT idempotent. Calling this twice for the same rate books the room twice and
  charges two reservation fees. If a call times out, poll the job; do not re-book.
- **Note:** the fee is charged BEFORE the room is committed, so a declined card costs nothing —
  no reservation exists and nothing is charged.

### get_hotel_booking
Collect the result of a booking started with `book_hotel`.
- **Cost:** FREE
- **Endpoint:** `GET /api/v1/hotels/booking/{booking_job_id}`
- **Output:** status, and on success confirmation, reservation_fee_charged, pay_link, balance_due,
  balance_due_by, terms (including the full cancellation ladder)
- **Note:** `balance_due_by` is the supplier's own auto-cancellation date, not advisory. Miss it and
  the room is released.

### cancel_hotel_booking
Release a hotel reservation.
- **Cost:** Free until `balance_due_by`; after that the hotel's own ladder applies and can reach
  100%. The 5% reservation fee is NOT refunded.
- **Endpoint:** `POST /api/v1/hotels/cancel`
- **Input:** confirmation
- **Output:** confirmation, charge
- **Note:** drives a browser at the supplier and takes over a minute. If it times out, do NOT
  assume it failed — re-check before retrying.

### register
Register a new AI agent.
- **Cost:** FREE
- **Input:** agent_name, email
- **Output:** api_key (permanent credential)

### setup_payment
Attach a payment card for booking. **Required before booking flights.**
- **Cost:** FREE (attaching the card is free; you are charged the ticket price when you book)
- **Input:** token (e.g. "tok_visa" for testing) or payment_method_id or card details
- **Output:** Payment status confirmation
- **Note:** Must be called once before your first booking. The card stays on file for future bookings.

### get_agent_profile
Get current agent's profile, usage stats, and payment status.
- **Cost:** FREE
- **Output:** Agent details, search count, booking count, payment status

## Authentication

**PFS (recommended — almost every agent):** a Bearer token from `letsfg auth` — a
zero-amount card setup, nothing charged. Search and flight booking both work
with it; hotels do not (see below).

```
Authorization: Bearer eyJ...
```

Get a token: `POST /api/agent-access/request` → present a card at the returned
`setup_url` (or headlessly via a Stripe token) → `POST /api/agent-access/verify`
→ 90-day token. Full flow: <https://letsfg.co/for-agents>.

**Developer API (business / high-volume):** every endpoint except `register`
requires an `X-API-Key` header.

```
X-API-Key: letsfg_...
```

Get your key by calling `POST /api/v1/agents/register` with agent_name and email. The key is permanent — save it once.

Before your first unlock, attach a payment method via `POST /api/v1/agents/setup-payment` (or use the MPP crypto path on the `402` challenge).

## Complete Workflow

### Flight Booking — PFS (2 API calls, free)

```
1. POST /api/search                    → Search flights (FREE), returns search_id
2. POST /api/agent-book                → Book directly — no unlock step, no LetsFG fee
```

### Flight Booking — Developer API (5 API calls)

```
1. POST /api/v1/agents/register        → Get API key (once)
2. POST /api/v1/agents/setup-payment   → Attach payment card (once)
3. POST /api/v1/flights/search         → Search flights (FREE)
4. POST /api/v1/bookings/unlock        → Unlock offer (legacy, Developer API only) → returns booking_url
5. POST /api/v1/bookings/book          → Book flight (ticket price charged via Stripe)
```

### Hotel Booking (Developer API key required — the PFS Bearer token does not work here)

```
1. POST /api/v1/agents/setup-payment       → Card on file (required for SEARCH too)
2. POST /api/v1/hotels/destinations        → Place name → city_id
3. POST /api/v1/hotels/search              → Bookable rates (free, card still required)
4. POST /api/v1/hotels/book                → Returns booking_job_id — NOT a booking
5. GET  /api/v1/hotels/booking/{job_id}    → Poll ~20s until succeeded/failed
                                             → confirmation + pay_link + balance_due_by
6. POST /api/v1/hotels/cancel              → Optional; free until balance_due_by
```

5% is charged to the card at step 4 as a non-refundable reservation fee; the balance is paid
directly to the supplier through `pay_link` by `balance_due_by`, which is the supplier's own
auto-cancellation date. Never repeat step 4 for the same rate — that books the room twice.

## CLI Usage

```bash
pip install letsfg

letsfg auth   # zero-amount card setup, nothing charged — 90-day Bearer token

# Search flights — prints search_id, needed for book
letsfg search LHR JFK 2026-04-15
letsfg search LON BCN 2026-04-01 --return 2026-04-08 --cabin C --sort price
letsfg search GDN BER 2026-05-10 --adults 2 --children 1

# Resolve locations
letsfg locations "New York"

# Book — free, ticket price only, no LetsFG fee, no unlock step
letsfg book off_xxx --search-id srch_xxx \
  --passenger '{"given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m"}' \
  --email john.doe@example.com

# Machine-readable output
letsfg search GDN BER 2026-03-03 --json
```

Developer API instead? `letsfg register` + `letsfg setup-payment` once, then
`letsfg search ... --api-key letsfg_...`, `letsfg unlock off_xxx --api-key letsfg_...`,
`letsfg book off_xxx --api-key letsfg_... --passenger '{"id":"pas_0",...}' --email ...`.

## Python SDK Usage

```python
from letsfg import LetsFG

bt = LetsFG()  # reads the Bearer token from `letsfg auth`

# Search
results = bt.search("LHR", "JFK", "2026-04-15")
for offer in results.offers:
    print(f"{offer.price} {offer.currency} — {', '.join(offer.airlines)}")

# Book — free, ticket price only, no LetsFG fee, no unlock step
result = bt.book(
    offer_id=results.offers[0].id,
    passengers=[{
        "given_name": "John",
        "family_name": "Doe",
        "born_on": "1990-01-15",
        "gender": "m",
        "phone_number": "+447123456789",
    }],
    contact_email="john@example.com",
    search_id=results.search_id,
)
if result["booked"]:
    print(f"Order: {result['order_id']}")
else:
    print(f"Booking link (nothing charged): {result['booking_url']}")
```

Developer API instead? `LetsFG(api_key="letsfg_...")`, then `bt.unlock(offer_id)`
before `bt.book(...)` — returns a `BookingResult` with `booking_reference` (PNR).

## MCP Server Setup

**Remote (Streamable HTTP) — Developer API only:**

```json
{
  "mcpServers": {
    "letsfg": {
      "url": "https://letsfg.co/developers/api/mcp",
      "headers": {
        "X-API-Key": "letsfg_..."
      }
    }
  }
}
```

**Local (stdio) — free PFS path:**

```bash
npm install -g letsfg-mcp
LETSFG_BEARER_TOKEN=eyJ...  letsfg-mcp   # token from `letsfg auth`
```

The local server also accepts `LETSFG_API_KEY` instead, for the Developer API.
`book_flight` dispatches automatically based on which one is set.

## MCP Tools

| Tool | Description | Cost |
|------|-------------|------|
| `search_flights` | Search hundreds of airlines via server-side engine | FREE |
| `resolve_location` | City name → IATA code | FREE |
| `book_flight` | Book an offer. PFS: direct, no unlock step. Developer API: requires `unlock_flight_offer` first | Ticket price only, no LetsFG fee (PFS) |
| `unlock_flight_offer` | **[Developer API only]** Confirm price, reveal booking URL, reserve 30min. Legacy — not part of the agent flow | — |
| `setup_payment` | **[Developer API only]** Attach payment card | FREE |
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
| `PaymentRequiredError` | 402 | No payment method (legacy flow) |
| `OfferExpiredError` | 410 | Offer no longer available |
| `LetsFGError` | 422 | Invalid request parameters |
| `LetsFGError` | 429 | Too many requests (retry with backoff) |
| `LetsFGError` | 502 | Upstream airline/hotel API error |

### Authentication Failure Recovery

```python
from letsfg import LetsFG
from letsfg.connectors.auth import BearerTokenError

try:
    bt = LetsFG()  # reads the Bearer token from `letsfg auth`
    flights = bt.search("LHR", "JFK", "2026-04-15")
except BearerTokenError:
    print("Token expired or missing — run `letsfg auth` again")
```

Developer API:

```python
from letsfg import LetsFG, AuthenticationError

try:
    bt = LetsFG(api_key="letsfg_...")
    flights = bt.search("LHR", "JFK", "2026-04-15")
except AuthenticationError:
    # API key invalid or expired — re-register
    creds = LetsFG.register("my-agent", "agent@example.com")
    bt = LetsFG(api_key=creds["api_key"])
    bt.setup_payment(token="tok_visa")  # re-attach payment on the new key
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
| Unlock | 20 req/min | 2-5s |
| Book | 10 req/min | 3-10s |
| Search hotels | 30 req/min | 3-10s |
| Register | 5 req/min | <1s |

## Pricing Summary

| Action | Cost |
|--------|------|
| Search (flights, hotels, transfers, activities) | **Free** |
| Resolve locations | **Free** |
| Register agent | **Free** |
| Setup payment | **Free** |
| View profile | **Free** |
| Book flight (PFS, no unlock needed) | **The price shown on the offer** — no LetsFG fee |
| Unlock offer (Developer API only) | Legacy path, not part of the agent flow — use `book_flight` directly |
| Book flight (Developer API, after unlock) | **The price shown on the offer** |
| Hotel booking | Room price only |
| Hotel cancellation | Per cancellation policy |

## Key Facts

- Hundreds of airlines via server-side engine
- Hotels and activities via direct APIs
- Zero price bias — no demand inflation, no cookie tracking
- Typically cheaper than booking through a single OTA, because it compares airlines and the major booking sites in one pass
- Real airline PNR codes and hotel confirmations
- E-tickets sent directly to passenger email
- Search is always free and unlimited
- PFS (Bearer token): book directly, no unlock step, no LetsFG fee on booking
- Developer API: unlock reveals the direct booking URL, then book (legacy — the agent flow books directly)
- API designed for machines, not browsers
