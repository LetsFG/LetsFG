# LetsFG — Your AI agent just learned to book flights.

**Server-side engine. Real prices. One function call.** Search hundreds of airlines at raw airline prices — **$20–$50 cheaper** than Booking.com, Kayak, and other OTAs.

[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![PyPI](https://img.shields.io/pypi/v/letsfg)](https://pypi.org/project/letsfg/)

## Two ways to use LetsFG

| | **CLI / SDK** (PFS Bearer token) | **Developer API** |
|---|---|---|
| **Search cost** | Free (one-time `letsfg auth`, nothing charged) | Prepaid credits |
| **Booking** | `POST /api/agent-book` — confirmed order or a booking link, no LetsFG fee | Direct airline URL (unlock required first, 1% fee min $3) |
| **Speed** | 60–90 s | 2–5 s (discover) · 60–90 s (full) |
| **Setup** | `pip install letsfg && letsfg auth` | [letsfg.co/developers](https://letsfg.co/developers) |

> **Want direct airline URLs without any per-booking fee?** Use the [Developer API](https://letsfg.co/developers) — prepaid credits, results in seconds, no per-booking fee.

## Install

```bash
pip install letsfg
```

Authenticate once by putting a payment method on file (zero-amount, nothing charged), then search is free and unlimited:

```bash
letsfg auth           # one-time card-on-file setup → 90-day Bearer token (nothing charged)
letsfg search LHR BCN 2026-06-15
```

**Search and booking are both free.** `letsfg auth` (zero-amount card setup) is
all you need — no unlock step, no LetsFG fee on the CLI/SDK path. The 1% unlock
fee (min $3) only exists on the separate, paid Developer API.

## Authentication

```bash
letsfg auth   # zero-amount Stripe card setup — nothing charged, saves a 90-day
              # Bearer token to ~/.letsfg/config.json
```

```python
from letsfg import LetsFG

# Reads the Bearer token letsfg auth saved (or LETSFG_BEARER_TOKEN env var)
bt = LetsFG()
```

Prefer the paid Developer API instead? Register there and pass an `api_key` —
`search()`/`book()` dispatch automatically based on which credential is set:

```python
# Register (one-time, no auth needed) — Developer API only, most agents don't need this
creds = LetsFG.register("my-agent", "agent@example.com")
bt = LetsFG(api_key=creds["api_key"])  # or set LETSFG_API_KEY env var

# Setup payment (required before unlock)
bt.setup_payment(token="tok_visa")  # Stripe test token
# or: bt.setup_payment(payment_method_id="pm_1234567890")
```

> The API accepts only Stripe-generated tokens or `payment_method_id` values — raw card numbers are not accepted.

### Verify Your Credentials

```python
# Check that auth + payment are working
profile = bt.me()
print(f"Agent: {profile['agent_name']}")
print(f"Payment: {profile.get('payment_status', 'not set up')}")
print(f"Searches: {profile.get('search_count', 0)}")
```

### Auth Failure Recovery

```python
from letsfg.connectors.auth import BearerTokenError
from letsfg import LetsFG

try:
    bt = LetsFG()
    flights = bt.search("LHR", "JFK", "2026-04-15")
except BearerTokenError:
    print("Token expired or missing — run `letsfg auth` again")
```

## Quick Start (Python)

```python
from letsfg import LetsFG

bt = LetsFG()  # reads the Bearer token from `letsfg auth`

# Search flights — FREE
flights = bt.search("GDN", "BER", "2026-03-03")
print(f"{flights.total_results} offers, cheapest: {flights.cheapest.summary()}")

# Book — free, ticket price only, no LetsFG fee. No unlock step.
result = bt.book(
    offer_id=flights.cheapest.id,
    passengers=[{
        "given_name": "John",
        "family_name": "Doe",
        "born_on": "1990-01-15",
        "gender": "m",
    }],
    contact_email="john@example.com",
    search_id=flights.search_id,
)
if result["booked"]:
    print(f"Order: {result['order_id']}")
else:
    print(f"Booking link (nothing charged): {result['booking_url']}")
```

## Multi-Passenger Search

Searching with multiple passengers works on both paths. Booking more than one
passenger in a single call is **Developer API only** — the free PFS `book()`
books one passenger per call.

```python
# 2 adults + 1 child, round-trip, premium economy
flights = bt.search(
    "LHR", "JFK", "2026-06-01",
    return_date="2026-06-15",
    adults=2,
    children=1,
    cabin_class="W",  # W=premium, M=economy, C=business, F=first
    sort="price",
)

# passenger_ids will be ["pas_0", "pas_1", "pas_2"]
print(f"Passenger IDs: {flights.passenger_ids}")

# Developer API: unlock, then book with details for EACH passenger
unlocked = bt.unlock(flights.cheapest.id)
booking = bt.book(
    offer_id=unlocked.offer_id,
    passengers=[
        {"id": "pas_0", "given_name": "John", "family_name": "Doe", "born_on": "1990-01-15", "gender": "m", "title": "mr"},
        {"id": "pas_1", "given_name": "Jane", "family_name": "Doe", "born_on": "1992-03-20", "gender": "f", "title": "ms"},
        {"id": "pas_2", "given_name": "Tom", "family_name": "Doe", "born_on": "2018-05-10", "gender": "m", "title": "mr"},
    ],
    contact_email="john@example.com",
)
```

## Resolve Locations

Always resolve city names to IATA codes before searching:

```python
locations = bt.resolve_location("New York")
# [{"iata_code": "JFK", "name": "John F. Kennedy", "type": "airport", "city": "New York"}, ...]

# Use in search
flights = bt.search(locations[0]["iata_code"], "LAX", "2026-04-15")
```

## Working with Search Results

```python
flights = bt.search("LON", "BCN", "2026-04-01", return_date="2026-04-08", limit=50)

# Iterate all offers
for offer in flights.offers:
    print(f"{offer.owner_airline}: {offer.currency} {offer.price}")
    print(f"  Route: {offer.outbound.route_str}")
    print(f"  Duration: {offer.outbound.total_duration_seconds // 3600}h")
    print(f"  Stops: {offer.outbound.stopovers}")
    print(f"  Refundable: {offer.conditions.get('refund_before_departure', 'unknown')}")
    print(f"  Changeable: {offer.conditions.get('change_before_departure', 'unknown')}")

# Filter: direct flights only
direct = [o for o in flights.offers if o.outbound.stopovers == 0]

# Filter: specific airline
ba = [o for o in flights.offers if "British Airways" in o.airlines]

# Filter: refundable only
refundable = [o for o in flights.offers if o.conditions.get("refund_before_departure") == "allowed"]

# Sort by duration
by_duration = sorted(flights.offers, key=lambda o: o.outbound.total_duration_seconds)

# Cheapest offer
print(f"Best: {flights.cheapest.price} {flights.cheapest.currency}")
```

## Starlink Wi-Fi

Offers may carry `starlink`: `confirmed_all` / `confirmed_some` mean the carrier
has **fully** fitted that aircraft type; `likely_all` / `likely_some` mean the
rollout on that type is underway but incomplete. Segments carry `confirmed` or
`likely`.

Only `confirmed_*` is safe to state as fact — `likely_*` is a signal, not a
promise. Anything ending `_some` has at least one leg without it. An **absent**
field means no information, **not** an absence of Wi-Fi.

Full semantics: [docs/api-search.md](https://github.com/LetsFG/LetsFG/blob/main/docs/api-search.md#starlink-wi-fi).

## Error Handling

```python
from letsfg import LetsFG, LetsFGError
from letsfg.connectors.auth import BearerTokenError

bt = LetsFG()  # reads the Bearer token from `letsfg auth`

# Handle invalid locations
try:
    flights = bt.search("INVALID", "JFK", "2026-04-15")
except LetsFGError as e:
    if e.status_code == 422:
        # Resolve the location first
        locations = bt.resolve_location("London")
        flights = bt.search(locations[0]["iata_code"], "JFK", "2026-04-15")

# Handle booking (free PFS path — no unlock step)
try:
    result = bt.book(
        offer_id=flights.cheapest.id, passengers=[...],
        contact_email="...", search_id=flights.search_id,
    )
    if not result["booked"]:
        print(f"Booking link (nothing charged): {result['booking_url']}")
except BearerTokenError:
    print("Token expired — run `letsfg auth` again")
```

Developer API path adds `unlock()` before `book()`, and its own error modes:

```python
from letsfg import LetsFG, LetsFGError, PaymentRequiredError, OfferExpiredError

bt = LetsFG(api_key="letsfg_...")
try:
    unlocked = bt.unlock(offer_id)
    booking = bt.book(offer_id=unlocked.offer_id, passengers=[...], contact_email="...")
except PaymentRequiredError:
    print("Run bt.setup_payment() first")
except OfferExpiredError:
    print("Offer expired, or the 30-minute post-unlock window closed — search and unlock again")
except LetsFGError as e:
    print(f"API error ({e.status_code}): {e.message}")
```

| Exception | HTTP Code | Cause |
|-----------|-----------|-------|
| `AuthenticationError` | 401 | Missing or invalid API key (Developer API) |
| `BearerTokenError` | 401 | Missing or expired Bearer token — run `letsfg auth` again (PFS) |
| `PaymentRequiredError` | 402 | No payment method (call `setup_payment()`, Developer API) |
| `OfferExpiredError` | 410 | Offer no longer available (Developer API) |
| `LetsFGError` | any | Base class for all API errors |

### Timeout and Retry Pattern

Full cloud search takes 60–90 s (async polling). Use retry with backoff for transient errors:

```python
import time
from letsfg import LetsFG, LetsFGError

bt = LetsFG()

def search_with_retry(origin, dest, date, max_retries=3):
    """Retry with exponential backoff on rate limit or timeout."""
    for attempt in range(max_retries):
        try:
            return bt.search(origin, dest, date)
        except LetsFGError as e:
            if "429" in str(e) or "rate limit" in str(e).lower():
                wait = 2 ** attempt  # 1s, 2s, 4s
                print(f"Rate limited, waiting {wait}s...")
                time.sleep(wait)
            elif "timeout" in str(e).lower() or "504" in str(e):
                print(f"Timeout, retrying ({attempt + 1}/{max_retries})...")
                time.sleep(1)
            else:
                raise
    raise LetsFGError("Max retries exceeded")
```

### Rate Limits

| Endpoint | Rate Limit | Typical Latency |
|----------|-----------|------------------|
| Search | No hard limit (billing is the natural governor) | 60–90 s |
| Resolve location | 120 req/min | < 1 s |
| Unlock | 20 req/min | 2–5 s |
| Book | 10 req/min | 3–10 s |

## Search Wide, Book Once

Searching is **free and unlimited**. On PFS, booking goes through `POST
/api/agent-book` — ticket price only, no LetsFG fee. Compare before booking:

```python
# Search multiple dates (free) — compare before booking
dates = ["2026-04-01", "2026-04-02", "2026-04-03"]
best = None
for date in dates:
    result = bt.search("LON", "BCN", date)
    if result.offers and (best is None or result.cheapest.price < best[1].price):
        best = (date, result)

# Book only the winner
if best:
    date, result = best
    booking = bt.book(
        offer_id=result.cheapest.id, passengers=[...],
        contact_email="...", search_id=result.search_id,
    )
```

On the Developer API, the same idea applies before `unlock()` (1% fee, min $3)
— search every candidate for free, then unlock only the winner.

## Quick Start (CLI)

```bash
# Auth (one-time — saves Bearer token to ~/.letsfg/config.json)
letsfg auth

# Search (1 adult, one-way, economy — defaults)
letsfg search GDN BER 2026-03-03 --sort price

# Multi-passenger round trip
letsfg search LON BCN 2026-04-01 --return 2026-04-08 --adults 2 --children 1 --cabin M

# Business class, direct flights only
letsfg search JFK LHR 2026-05-01 --adults 3 --cabin C --max-stops 0

# Machine-readable output (for agents) — includes search_id, needed for book
letsfg search LON BCN 2026-04-01 --json

# Book — free, ticket price only, no LetsFG fee. No unlock step.
letsfg book off_xxx --search-id srch_xxx \
  --passenger '{"given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m"}' \
  --email john@example.com

# Resolve location
letsfg locations "Berlin"
```

### Search Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--return` | `-r` | _(one-way)_ | Return date YYYY-MM-DD |
| `--adults` | `-a` | `1` | Adults (1–9) |
| `--children` | | `0` | Children 2–11 years |
| `--cabin` | `-c` | _(any)_ | `M` economy, `W` premium, `C` business, `F` first |
| `--max-stops` | `-s` | `2` | Max stopovers (0–4) |
| `--currency` | | `EUR` | Currency code |
| `--limit` | `-l` | `20` | Max results (1–100) |
| `--sort` | | `price` | `price` or `duration` |
| `--json` | `-j` | | Raw JSON output |

## All CLI Commands

| Command | Description | Cost |
|---------|-------------|------|
| `auth` | One-time card-on-file setup → 90-day Bearer token. Nothing charged | FREE |
| `search` | Search flights between any two airports, prints `search_id` | FREE |
| `locations` | Resolve city name to IATA codes | FREE |
| `book` | Book an offer from your search (`--search-id` required) | Ticket price only, no LetsFG fee |
| `me` | Show agent profile and usage stats | FREE |
| `unlock` | **[Developer API only]** Unlock offer (confirms price, reveals booking URL). Requires `--api-key` | 1% of ticket, min $3 |
| `register` | **[Developer API only]** Register new Developer API key | FREE |
| `setup-payment` | **[Developer API only]** Attach payment card (required for unlock) | FREE |

Every command supports `--json` for machine-readable output.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LETSFG_BEARER_TOKEN` | PFS Bearer token (from `letsfg auth`). Takes priority over `~/.letsfg/config.json`. |
| `LETSFG_API_KEY` | Developer API key (prepaid credits path) |
| `LETSFG_BASE_URL` | API URL override (default: `https://letsfg.co`) |

## How It Works

1. **Search** — Free. The server-side engine queries hundreds of airlines and returns real-time offers.
2. **Book** — Call `POST /api/agent-book` with your Bearer token. It returns either a confirmed order or a direct booking link for that exact offer. Ticket price only, no LetsFG fee, no unlock step.

The Developer API is a separate, paid product: search consumes prepaid credits, and booking a chosen offer requires an `unlock` call (1% fee, min $3) before `book`, which returns a direct airline booking URL.

---

## Also Available As

- **MCP Server**: `npx letsfg-mcp` — [npm](https://www.npmjs.com/package/letsfg-mcp)
- **JS/TS SDK**: `npm install letsfg` — [npm](https://www.npmjs.com/package/letsfg)
- **Try without installing**: [letsfg.co](https://letsfg.co) — search instantly in your browser
- **GitHub**: [LetsFG/LetsFG](https://github.com/LetsFG/LetsFG)

> ⭐ **[Star the repo](https://github.com/LetsFG/LetsFG)** — we appreciate the support.

## License

MIT

## 🏨 Hotels — new, and live

Your agent can now book hotels, not just flights. Same API key, same card on file.

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
print(hotel["name"], offer["price"], stays["currency"])
# Hotel Gromada Warszawa Centrum 669.86 PLN

booking = lfg.book_hotel_and_wait(
    session_id=stays["session_id"],
    hotel_code=hotel["hotel_code"],
    combination_id_v2=offer["combination_id_v2"],
    expected_price=offer["price"],
    expected_balance=offer["balance_to_supplier"],
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12",
    guests=[{"title": "Mr", "first_name": "Jan", "last_name": "Kowalski"}],
    email="guest@example.com", phone="512345678",
)
print(booking["confirmation"], booking["pay_link"])
```

### How you pay

**5% now, the rest to the hotel later.** At booking we charge 5% of the price
to your card as a reservation fee. The remaining balance is paid **directly to
the supplier** through a `pay_link` we return — we never hold it.

`balance_due_by` is the supplier's own auto-cancellation date, not a date we
invent. Miss it and the room is released.

The 5% is **non-refundable**. Cancelling before `balance_due_by` costs nothing
else; after it, the hotel's own cancellation ladder applies and can reach 100%.
That ladder ships in the booking's `terms`, so you can always see the cost before
you cancel.

### What search costs

Search is metered separately from booking, on **either** auth path (free PFS
Bearer token or Developer API key — both count against the same agent):
**the first 1,000 `search_hotels` calls since your last hotel booking are
free.** Past that, searches are billed in blocks of 1,000 for **$5**
(~$0.005/search) from your prepaid balance — refused with a 402 if the
balance can't cover the next block, never silently allowed. Book a hotel
and the count resets to zero. Resolving a city name (`hotel_destinations`)
is not metered, only the search call itself.

### Things worth knowing before you build

- **A card on file is required for every hotel call, including search.** That is
  unusual and it is deliberate: a hotel search opens a real session at the
  supplier, and booking blocks a real rate. We would rather refuse up front than
  let you reach the point of commitment and discover you cannot pay. The same
  card that authorises flight booking authorises hotels — there is no separate
  hotel signup.
- **Only free-cancellation, pay-later rates are sold.** Those are the rates where
  the balance can safely be settled with the supplier after booking, which is
  what makes 5%-now/rest-later work at all. You will see fewer results than a
  metasearch shows you. Every one of them can actually be booked.
- **Booking is asynchronous.** `book_hotel` returns a `booking_job_id`, not a
  booking — the real thing takes minutes. Poll `hotel_booking(job_id)` until
  `status` is `succeeded` or `failed`, or call `book_hotel_and_wait` and let the
  SDK do it. This is not ceremony: it is what makes it impossible to charge a
  card and then lose the confirmation to a timeout.
- **The fee is charged before the room is committed.** A declined card therefore
  costs nothing to unwind — no reservation exists and nothing is charged.
- **Do not retry a booking blindly.** Calling `book_hotel` twice for the same
  rate books the room twice and charges two reservation fees.
- `price` is what the guest pays. There is no wholesale figure in the response to
  quote by mistake.

### JavaScript

```javascript
import { LetsFG } from 'letsfg';
const lfg = new LetsFG({ apiKey: process.env.LETSFG_API_KEY });

const [city] = await lfg.hotelDestinations('Warsaw');
const stays = await lfg.searchHotels({
  cityId: city.Id, cityName: city.Name,
  checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2,
});

const booking = await lfg.bookHotelAndWait({ /* ...offer + guest details... */ });
console.log(booking.confirmation, booking.pay_link);
```

### MCP

Five new tools, in the order you call them: `resolve_hotel_city` →
`search_hotels` → `book_hotel` → `get_hotel_booking` → `cancel_hotel_booking`.

