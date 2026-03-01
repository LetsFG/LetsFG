# BoostedTravel — Agent-Native Flight Search & Booking

<!-- mcp-name: com.boostedchat/travel -->

Search 400+ airlines at raw airline prices — **$20-50 cheaper** than Booking.com, Kayak, and other OTAs. Zero browser, zero markup, zero config. Built for autonomous AI agents.

## Install

```bash
pip install boostedtravel           # SDK only (zero dependencies)
pip install boostedtravel[cli]      # SDK + CLI (adds typer, rich)
```

## Authentication

```python
from boostedtravel import BoostedTravel

# Register (one-time, no auth needed)
creds = BoostedTravel.register("my-agent", "agent@example.com")
print(creds["api_key"])  # "trav_xxxxx..." — save this

# Option A: Pass API key directly
bt = BoostedTravel(api_key="trav_...")

# Option B: Set BOOSTEDTRAVEL_API_KEY env var, then:
bt = BoostedTravel()

# Setup payment (required before unlock)
bt.setup_payment(token="tok_visa")  # Stripe payment token
```

The API key is sent as `X-API-Key` header on every request. The SDK handles this automatically.

## Quick Start (Python)

```python
from boostedtravel import BoostedTravel

bt = BoostedTravel(api_key="trav_...")

# Search flights — FREE
flights = bt.search("GDN", "BER", "2026-03-03")
print(f"{flights.total_results} offers, cheapest: {flights.cheapest.summary()}")

# Unlock — $1
unlock = bt.unlock(flights.cheapest.id)
print(f"Confirmed price: {unlock.confirmed_currency} {unlock.confirmed_price}")

# Book — FREE after unlock
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
from boostedtravel import (
    BoostedTravel, BoostedTravelError,
    AuthenticationError, PaymentRequiredError, OfferExpiredError,
)

bt = BoostedTravel(api_key="trav_...")

# Handle invalid locations
try:
    flights = bt.search("INVALID", "JFK", "2026-04-15")
except BoostedTravelError as e:
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
except BoostedTravelError as e:
    print(f"API error ({e.status_code}): {e.message}")
```

| Exception | HTTP Code | Cause |
|-----------|-----------|-------|
| `AuthenticationError` | 401 | Missing or invalid API key |
| `PaymentRequiredError` | 402 | No payment method (call `setup_payment()`) |
| `OfferExpiredError` | 410 | Offer no longer available |
| `BoostedTravelError` | any | Base class for all API errors |

## Minimizing Unlock Costs

Searching is **free and unlimited**. Only unlock ($1) costs money. Strategy:

```python
# Search multiple dates (free) — compare before unlocking
dates = ["2026-04-01", "2026-04-02", "2026-04-03"]
best = None
for date in dates:
    result = bt.search("LON", "BCN", date)
    if result.offers and (best is None or result.cheapest.price < best[1].price):
        best = (date, result.cheapest)

# Unlock only the winner ($1)
if best:
    unlocked = bt.unlock(best[1].id)
    # Book within 30 minutes (free)
    booking = bt.book(offer_id=unlocked.offer_id, passengers=[...], contact_email="...")
```

## Quick Start (CLI)

```bash
export BOOSTEDTRAVEL_API_KEY=trav_...

# Search (1 adult, one-way, economy — defaults)
boostedtravel search GDN BER 2026-03-03 --sort price

# Multi-passenger round trip
boostedtravel search LON BCN 2026-04-01 --return 2026-04-08 --adults 2 --children 1 --cabin M

# Business class, direct flights only
boostedtravel search JFK LHR 2026-05-01 --adults 3 --cabin C --max-stops 0

# Machine-readable output (for agents)
boostedtravel search LON BCN 2026-04-01 --json

# Unlock
boostedtravel unlock off_xxx

# Book
boostedtravel book off_xxx \
  --passenger '{"id":"pas_xxx","given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m","title":"mr","email":"john@example.com"}' \
  --email john@example.com

# Resolve location
boostedtravel locations "Berlin"
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
| `unlock` | Unlock offer (confirms price, reserves 30min) | $1 |
| `book` | Book flight (creates real airline PNR) | FREE |
| `register` | Register new agent, get API key | FREE |
| `setup-payment` | Attach payment card (payment token) | FREE |
| `me` | Show agent profile and usage stats | FREE |

Every command supports `--json` for machine-readable output.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BOOSTEDTRAVEL_API_KEY` | Your agent API key |
| `BOOSTEDTRAVEL_BASE_URL` | API URL (default: `https://api.boostedchat.com`) |

## How It Works

1. **Search** — Free, unlimited. Returns real-time offers from 400+ airlines via NDC/GDS.
2. **Unlock** — $1 proof-of-intent. Confirms latest price with airline, reserves offer for 30 minutes.
3. **Book** — FREE after unlock. Creates real airline reservation with PNR code.

Prices are cheaper because we connect directly to airlines — no OTA markup.

## For Agents

The SDK uses **zero external dependencies** (only Python stdlib `urllib`). This means:
- Safe to install in sandboxed environments
- No dependency conflicts
- Minimal attack surface
- Works on Python 3.10+

The `--json` flag on every CLI command outputs structured JSON for easy parsing by agents.

## License

MIT
