# LetsFG — Your AI agent just learned to book flights.

**Server-side engine. Real prices. One function call.** Search hundreds of airlines at raw airline prices — **$20–$50 cheaper** than Booking.com, Kayak, and other OTAs.

[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![PyPI](https://img.shields.io/pypi/v/letsfg)](https://pypi.org/project/letsfg/)

## Two ways to use LetsFG

| | **CLI / SDK** (PFS Bearer token) | **Developer API** |
|---|---|---|
| **Search cost** | Free (Twitter/X token, one-time `letsfg auth`) | Prepaid credits |
| **Booking URL** | 1% fee (min $3) via letsfg.co | Direct airline URL, no fee |
| **Speed** | 60–90 s | 2–5 s (discover) · 60–90 s (full) |
| **Setup** | `pip install letsfg && letsfg auth` | [letsfg.co/developers](https://letsfg.co/developers) |

> **Want direct airline URLs without any per-booking fee?** Use the [Developer API](https://letsfg.co/developers) — prepaid credits, results in seconds, no per-booking fee.

## Install

```bash
pip install letsfg
```

Authenticate once with a free Twitter/X challenge, then search is free and unlimited:

```bash
letsfg auth           # one-time Twitter/X challenge → 90-day Bearer token
letsfg search LHR BCN 2026-06-15
```

**Search is free.** Booking links require unlock (1% fee, min $3) — see [Unlocking offer results](#minimizing-unlock-costs) below.

## Authentication

```python
from letsfg import LetsFG

# Register (one-time, no auth needed)
creds = LetsFG.register("my-agent", "agent@example.com")
print(creds["api_key"])  # "trav_xxxxx..." — save this

# Option A: Pass API key directly
bt = LetsFG(api_key="trav_...")

# Option B: Set LETSFG_API_KEY env var, then:
bt = LetsFG()

# Setup payment (required before unlock) — two options:

# Option 1: Stripe test token (for development)
bt.setup_payment(token="tok_visa")

# Option 2: Stripe PaymentMethod ID (from Stripe.js or Elements)
bt.setup_payment(payment_method_id="pm_1234567890")
```

> The API accepts only Stripe-generated tokens or `payment_method_id` values — raw card numbers are not accepted.

The API key is sent as `X-API-Key` header on every request. The SDK handles this automatically.

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
from letsfg import LetsFG, AuthenticationError

try:
    bt = LetsFG(api_key="trav_...")
    flights = bt.search("LHR", "JFK", "2026-04-15")
except AuthenticationError:
    # Key invalid or expired — re-register to get a new one
    creds = LetsFG.register("my-agent", "agent@example.com")
    bt = LetsFG(api_key=creds["api_key"])
    bt.setup_payment(token="tok_visa")  # Re-attach payment on new key
    flights = bt.search("LHR", "JFK", "2026-04-15")
```

## Quick Start (Python)

```python
from letsfg import LetsFG

bt = LetsFG(api_key="trav_...")

# Search flights — FREE
flights = bt.search("GDN", "BER", "2026-03-03")
print(f"{flights.total_results} offers, cheapest: {flights.cheapest.summary()}")

# Unlock booking link (1% fee, min $3, charged via letsfg.co)
unlock = bt.unlock(flights.cheapest.id)
print(f"Confirmed price: {unlock.confirmed_currency} {unlock.confirmed_price}")

# Book — ticket price charged via Stripe (zero markup)
booking = bt.book(
    offer_id=flights.cheapest.id,
    passengers=[{
        "id": flights.passenger_ids[0],
        "given_name": "John",
        "family_name": "Doe",
        "born_on": "1990-01-15",
        "gender": "m",
        "title": "mr",
        "email": "john@example.com",
    }],
    contact_email="john@example.com"
)
print(f"PNR: {booking.booking_reference}")
```

## Multi-Passenger Search

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

# Book with details for EACH passenger
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

## Error Handling

```python
from letsfg import (
    LetsFG, LetsFGError,
    AuthenticationError, PaymentRequiredError, OfferExpiredError,
)

bt = LetsFG(api_key="trav_...")

# Handle invalid locations
try:
    flights = bt.search("INVALID", "JFK", "2026-04-15")
except LetsFGError as e:
    if e.status_code == 422:
        # Resolve the location first
        locations = bt.resolve_location("London")
        flights = bt.search(locations[0]["iata_code"], "JFK", "2026-04-15")

# Handle payment and expiry
try:
    unlocked = bt.unlock(offer_id)
except PaymentRequiredError:
    print("Run bt.setup_payment() first")
except OfferExpiredError:
    print("Offer expired — search again for fresh results")

# Handle booking failures
try:
    booking = bt.book(offer_id=unlocked.offer_id, passengers=[...], contact_email="...")
except OfferExpiredError:
    print("30-minute window expired — search and unlock again")
except AuthenticationError:
    print("Invalid API key")
except LetsFGError as e:
    print(f"API error ({e.status_code}): {e.message}")
```

| Exception | HTTP Code | Cause |
|-----------|-----------|-------|
| `AuthenticationError` | 401 | Missing or invalid API key |
| `PaymentRequiredError` | 402 | No payment method (call `setup_payment()`) |
| `OfferExpiredError` | 410 | Offer no longer available |
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

## Minimizing Unlock Costs

Searching is **free and unlimited**. Unlock via the Developer API is free; via the PFS / CLI path the fee (1% of ticket price, min $3) applies once per offer. Strategy:

```python
# Search multiple dates (free) — compare before unlocking
dates = ["2026-04-01", "2026-04-02", "2026-04-03"]
best = None
for date in dates:
    result = bt.search("LON", "BCN", date)
    if result.offers and (best is None or result.cheapest.price < best[1].price):
        best = (date, result.cheapest)

# Unlock only the winner (1% fee, min $3)
if best:
    unlocked = bt.unlock(best[1].id)
    # Book within 30 minutes (ticket price only)
    booking = bt.book(offer_id=unlocked.offer_id, passengers=[...], contact_email="...")
```

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

# Machine-readable output (for agents)
letsfg search LON BCN 2026-04-01 --json

# Unlock
letsfg unlock off_xxx

# Book
letsfg book off_xxx \
  --passenger '{"id":"pas_xxx","given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m","title":"mr","email":"john@example.com"}' \
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
| `auth` | One-time Twitter/X challenge → 90-day Bearer token | FREE |
| `search` | Search flights between any two airports | FREE |
| `locations` | Resolve city name to IATA codes | FREE |
| `unlock` | Unlock offer (confirms price, reveals booking URL) | 1% of ticket, min $3 |
| `book` | Book flight (creates real airline PNR) | Ticket price |
| `register` | Register new Developer API key | FREE |
| `setup-payment` | Attach payment card (required for unlock) | FREE |
| `me` | Show agent profile and usage stats | FREE |

Every command supports `--json` for machine-readable output.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LETSFG_BEARER_TOKEN` | PFS Bearer token (from `letsfg auth`). Takes priority over `~/.letsfg/config.json`. |
| `LETSFG_API_KEY` | Developer API key (prepaid credits path) |
| `LETSFG_BASE_URL` | API URL override (default: `https://letsfg.co`) |

## How It Works

1. **Search** — Free. The server-side engine queries hundreds of airlines and returns real-time offers.
2. **Unlock booking URL** — Pay the concierge fee (1% of ticket price, min $3) to receive the direct airline booking link. Or use the [Developer API](https://letsfg.co/developers) (prepaid credits) for fee-free direct links.
3. **Book** — Open the direct airline URL and complete the booking on the airline's own site.

Prices are cheaper because we connect directly to airlines — no OTA markup.

---

## Also Available As

- **MCP Server**: `npx letsfg-mcp` — [npm](https://www.npmjs.com/package/letsfg-mcp)
- **JS/TS SDK**: `npm install letsfg` — [npm](https://www.npmjs.com/package/letsfg)
- **Try without installing**: [letsfg.co](https://letsfg.co) — search instantly in your browser
- **GitHub**: [LetsFG/LetsFG](https://github.com/LetsFG/LetsFG)

> ⭐ **[Star the repo](https://github.com/LetsFG/LetsFG)** — we appreciate the support.

## License

MIT
