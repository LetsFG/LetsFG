# LetsFG — Your AI agent just learned to book flights.

**200+ airline connectors. Real prices. One function call.** Search 400+ airlines at raw airline prices — **$20–$50 cheaper** than Booking.com, Kayak, and other OTAs.

[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![PyPI](https://img.shields.io/pypi/v/letsfg)](https://pypi.org/project/letsfg/)

## Three ways to use LetsFG

| | **Local** (this SDK) | **letsfg.co** (website / agent API) | **Developer API** |
|---|---|---|---|
| **Search cost** | Free | Free | Prepaid credits |
| **Booking URL** | 1% concierge fee (min $3) via letsfg.co | 1% concierge fee (min $3) via letsfg.co | Direct airline URL, no fee |
| **Speed** | 1–15 min (local browsers) | Seconds | Seconds |
| **Setup** | `pip install letsfg` | [letsfg.co](https://letsfg.co) | [letsfg.co/developers](https://letsfg.co/developers) |

> **Want direct airline URLs without any per-booking fee?** Use the [Developer API](https://letsfg.co/developers) — prepaid credits, results in seconds, no checkout step.

## Install

```bash
pip install letsfg
```

Search flights immediately — no account, no API key:

```bash
letsfg search-local LHR BCN 2026-06-15
```

That fires 200+ airline connectors on your machine. **Search is free.** Booking links are delivered via the letsfg.co concierge flow (1% fee, min $3) — see [Unlocking offer results](#unlocking-offer-results) below.

```bash
# Search using only Brazilian sites
letsfg search BSB SDU 2026-05-24 --country BR
# Or by region
letsfg search GRU LIM 2026-06-15 --region latin-america
```

**Short on time?** Use `--mode fast` to search only OTAs + key airlines (~25 connectors, 20-40s instead of 6+ min):

```bash
letsfg search-local LHR BCN 2026-06-15 --mode fast
```

> ⭐ **[Star the repo](https://github.com/LetsFG/LetsFG) → register → unlimited access forever.** First 1,000 stars only.

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

# Setup payment (required before unlock) — three options:

# Option 1: Stripe test token (for development)
bt.setup_payment(token="tok_visa")

# Option 2: Stripe PaymentMethod ID (from Stripe.js or Elements)
bt.setup_payment(payment_method_id="pm_1234567890")

# Option 3: Raw card details (requires PCI-compliant Stripe account)
bt.setup_payment(card_number="4242424242424242", exp_month=12, exp_year=2027, cvc="123")
```

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

# Unlock — FREE
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

Airline APIs can be slow (2–15s for search). Use retry with backoff for production:

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
| Search | 60 req/min | 2-15s |
| Resolve location | 120 req/min | <1s |
| Unlock | 20 req/min | 2-5s |
| Book | 10 req/min | 3-10s |

## Minimizing Unlock Costs

Searching is **free and unlimited**. Unlock via the Developer API is also free; via the local/website path the concierge fee (1% of ticket price, min $3) applies once per offer. Strategy:

```python
# Search multiple dates (free) — compare before unlocking
dates = ["2026-04-01", "2026-04-02", "2026-04-03"]
best = None
for date in dates:
    result = bt.search("LON", "BCN", date)
    if result.offers and (best is None or result.cheapest.price < best[1].price):
        best = (date, result.cheapest)

# Unlock only the winner (free)
if best:
    unlocked = bt.unlock(best[1].id)
    # Book within 30 minutes (free)
    booking = bt.book(offer_id=unlocked.offer_id, passengers=[...], contact_email="...")
```

## Local Search (No API Key)

> **Note:** Local search results return masked booking links by default. Each offer includes `offer_ref` and `payment_token` fields. To get a direct airline booking URL, you have two options: use the **concierge unlock flow** (1% fee, min $3 — no API key needed) or sign up for the **Developer API** at [letsfg.co/developers](https://letsfg.co/developers) for fee-free direct links.

The SDK includes 200 connectors for airlines that run directly on your machine. No API key, no backend, completely free:

```python
from letsfg.local import search_local

# Fires all relevant airline connectors — Ryanair, Wizz Air, EasyJet, etc.
result = await search_local("GDN", "BCN", "2026-06-15")
print(f"{result['total_results']} offers from local connectors")

# Limit browser concurrency for constrained environments
result = await search_local("GDN", "BCN", "2026-06-15", max_browsers=4)
```

The full search (`bt.search()`) runs both local connectors and cloud providers simultaneously and merges results.

## Unlocking offer results

Local search results include `offer_ref` and `payment_token` on each offer. Use these to get the direct airline booking URL via the concierge flow (no API key required):

```python
import httpx
import time

# 1. Pick an offer from local search results
offer = result["offers"][0]
offer_id      = offer["id"]
offer_ref     = offer["offer_ref"]
payment_token = offer["payment_token"]
price         = offer["price"]        # ticket price as string, e.g. "312.50"
currency      = offer["currency"]     # e.g. "USD"

# 2. Initiate checkout — returns a Stripe checkout URL
# Fee = max(price × 1%, $3.00). No API key needed.
resp = httpx.post(
    "https://letsfg.co/api/developers/checkout",
    json={
        "offer_id":      offer_id,
        "offer_ref":     offer_ref,
        "payment_token": payment_token,
        "currency":      currency,
        "price":         price,
    },
)
resp.raise_for_status()
checkout = resp.json()
checkout_url = checkout["checkout_url"]

# 3. Present the checkout URL to the user (or open it in a browser)
print(f"Pay here: {checkout_url}")

# 4. Poll until payment is confirmed
booking_url = None
while not booking_url:
    time.sleep(3)
    verify = httpx.get(
        "https://letsfg.co/api/developers/payment-verify",
        params={"token": payment_token},
    )
    data = verify.json()
    if data.get("verified"):
        booking_url = data["booking_url"]

# 5. booking_url is the direct airline link — no further fees
print(f"Book here: {booking_url}")
```

To skip the per-booking fee entirely, use the [Developer API](https://letsfg.co/developers) — it returns direct airline booking URLs on every search result.

## Quick Start (CLI)

```bash
export LETSFG_API_KEY=trav_...

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
| `search` | Search flights between any two airports | FREE |
| `locations` | Resolve city name to IATA codes | FREE |
| `unlock` | Unlock offer (confirms price, reserves 30min) | FREE |
| `book` | Book flight (creates real airline PNR) | Ticket price |
| `search-local` | Search 200 local airline connectors | FREE |
| `system-info` | Show system resources & concurrency tier | FREE |
| `register` | Register new agent, get API key | FREE |
| `setup-payment` | Attach payment card (payment token) | FREE |
| `me` | Show agent profile and usage stats | FREE |

Every command supports `--json` for machine-readable output.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LETSFG_API_KEY` | Your agent API key |
| `LETSFG_BASE_URL` | API URL (default: `https://letsfg.co/developers`) |
| `LETSFG_MAX_BROWSERS` | Max concurrent browser instances (1–32). Auto-detected from RAM if not set. |

## Performance Tuning

LetsFG auto-detects your system's available RAM and scales browser concurrency:

| Available RAM | Tier | Max Browsers |
|-------------|------|-------------|
| < 2 GB | Minimal | 2 |
| 2–4 GB | Low | 3 |
| 4–8 GB | Moderate | 5 |
| 8–16 GB | Standard | 8 |
| 16–32 GB | High | 12 |
| 32+ GB | Maximum | 16 |

```python
from letsfg import get_system_profile, configure_max_browsers

# Check system resources and recommended concurrency
profile = get_system_profile()
print(f"RAM: {profile['ram_available_gb']:.1f} GB available")
print(f"Tier: {profile['tier']} → {profile['recommended_max_browsers']} browsers")

# Override auto-detection
configure_max_browsers(4)  # clamps to 1–32
```

```bash
# Via CLI
letsfg system-info
letsfg system-info --json  # machine-readable

# Override via env var
export LETSFG_MAX_BROWSERS=4
letsfg search-local LHR BCN 2026-04-15

# Override via CLI flag
letsfg search-local LHR BCN 2026-04-15 --max-browsers 4
```

Priority: env var > explicit config/flag > auto-detect.

## How It Works

1. **Search** — Free. 200+ connectors fire on your machine and return real-time offers.
2. **Unlock booking URL** — Pay the concierge fee (1% of ticket price, min $3) via letsfg.co to receive the direct airline booking link. Or use the [Developer API](https://letsfg.co/developers) (prepaid credits) for fee-free direct links.
3. **Book** — Open the direct airline URL and complete the booking on the airline's own site.

Prices are cheaper because we connect directly to airlines — no OTA markup.

---

## Also Available As

- **MCP Server**: `npx letsfg-mcp` — [npm](https://www.npmjs.com/package/letsfg-mcp)
- **JS/TS SDK**: `npm install letsfg` — [npm](https://www.npmjs.com/package/letsfg)
- **Try without installing**: [letsfg.co](https://letsfg.co) — search instantly in your browser
- **GitHub**: [LetsFG/LetsFG](https://github.com/LetsFG/LetsFG)

> ⭐ **[Star the repo](https://github.com/LetsFG/LetsFG)** to unlock free access. First 1,000 stars only.

## License

MIT
