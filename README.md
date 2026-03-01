# BoostedTravel

Agent-native, CLI-native flight search & booking. Search 400+ airlines and book tickets straight from the terminal — no browser, no scraping, no token-burning automation. Built for AI agents and developers who need travel built into their workflow.

**API Base URL:** `https://api.boostedchat.com`

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PyPI](https://img.shields.io/pypi/v/boostedtravel)](https://pypi.org/project/boostedtravel/)
[![npm](https://img.shields.io/npm/v/boostedtravel)](https://www.npmjs.com/package/boostedtravel)

## Why BoostedTravel Exists

AI agents need a native, CLI-based way to search and book flights, hotels, and travel experiences. Without it, agents either burn massive amounts of tokens on browser automation and scraping — or simply can't do it at all. That's unacceptable in situations where time and cost matter.

BoostedTravel is an agent-native interface to find flights and everything travel-related. One command, real results, real bookings.

**You don't pay extra for the brand of a website.** Flight websites like Booking.com, Expedia, Google Flights, and Kayak inflate prices based on demand patterns, cookie tracking, browser fingerprinting, and surge pricing. The same flight that shows as $350 on those sites is often **$20–$50 cheaper** through BoostedTravel — because we return the raw airline price with zero markup or bias. Same flight, same airline, same seat — just cheaper.

## Price: BoostedTravel vs. Flight Websites

| | Google Flights / Booking.com / Expedia | **BoostedTravel** |
|---|---|---|
| Search flights | Free | **Free** |
| View full offer details & price | Free (with tracking/inflation) | **Free** (no tracking, no bias) |
| Book flight (checkout) | Ticket + website markup + surge pricing | **$1 unlock + ticket price** (no markup) |
| Price changes on repeat search? | Yes — goes up | **Never** |
| Total extra cost | $20–$50+ hidden in inflated price | **$1 flat** |

The $1 unlock is the only fee. You search for free, find exactly what you need with all the details, and only pay $1 to confirm the price and open checkout. After that, booking is free — you pay only the actual airline ticket price.

## Install

### CLI (Python — recommended for agents)

```bash
pip install boostedtravel
```

This gives you the `boostedtravel` command in your terminal:

```bash
# Register and get your API key
boostedtravel register --name my-agent --email you@example.com

# Save your key
export BOOSTEDTRAVEL_API_KEY=trav_...

# Search flights
boostedtravel search LHR JFK 2026-04-15

# Round trip with options
boostedtravel search LON BCN 2026-04-01 --return 2026-04-08 --cabin M --sort price

# Multi-passenger: 2 adults + 1 child
boostedtravel search GDN BER 2026-05-10 --adults 2 --children 1

# Business class, 3 adults, sorted by duration
boostedtravel search LHR SIN 2026-06-01 --adults 3 --cabin C --sort duration

# Resolve a city to IATA codes
boostedtravel locations "New York"

# Unlock an offer ($1)
boostedtravel unlock off_xxx

# Book the flight
boostedtravel book off_xxx \
  --passenger '{"id":"pas_0","given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m","title":"mr"}' \
  --email john.doe@example.com

# Check your profile & usage
boostedtravel me
```

All commands support `--json` for machine-readable output (perfect for agent pipelines):

```bash
boostedtravel search GDN BER 2026-03-03 --json | jq '.offers[0]'
```

### CLI (JavaScript/TypeScript)

```bash
npm install -g boostedtravel
```

Same commands, same interface:

```bash
boostedtravel search LHR JFK 2026-04-15 --json
boostedtravel unlock off_xxx
boostedtravel book off_xxx --passenger '...' --email john@example.com
```

### SDK (Python)

```python
from boostedtravel import BoostedTravel

bt = BoostedTravel(api_key="trav_...")
flights = bt.search("LHR", "JFK", "2026-04-15")
print(f"{flights.total_results} offers, cheapest: {flights.cheapest.summary()}")

# Unlock
unlocked = bt.unlock(flights.offers[0].id)

# Book
booking = bt.book(
    offer_id=unlocked.offer_id,
    passengers=[{"id": "pas_0", "given_name": "John", "family_name": "Doe", "born_on": "1990-01-15", "gender": "m", "title": "mr"}],
    contact_email="john.doe@example.com",
)
print(f"Booked! PNR: {booking.booking_reference}")
```

### SDK (JavaScript / TypeScript)

```typescript
import { BoostedTravel } from 'boostedtravel';

const bt = new BoostedTravel({ apiKey: 'trav_...' });
const flights = await bt.searchFlights({ origin: 'LHR', destination: 'JFK', dateFrom: '2026-04-15' });
console.log(`${flights.totalResults} offers`);
```

### MCP Server (Claude Desktop / Cursor / Windsurf)

For AI agents using Model Context Protocol:

```bash
npx boostedtravel-mcp
```

Add to your MCP config:

```json
{
  "mcpServers": {
    "boostedtravel": {
      "command": "npx",
      "args": ["-y", "boostedtravel-mcp"],
      "env": {
        "BOOSTEDTRAVEL_API_KEY": "trav_your_api_key"
      }
    }
  }
}
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `boostedtravel register` | Get your API key |
| `boostedtravel search <origin> <dest> <date>` | Search flights (free) |
| `boostedtravel locations <query>` | Resolve city/airport to IATA codes |
| `boostedtravel unlock <offer_id>` | Unlock offer details ($1) |
| `boostedtravel book <offer_id>` | Book the flight (free after unlock) |
| `boostedtravel setup-payment` | Set up payment method |
| `boostedtravel me` | View profile & usage stats |

All commands accept `--json` for structured output and `--api-key` to override the env variable.

### Search Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--return` | `-r` | _(one-way)_ | Return date for round-trip (YYYY-MM-DD) |
| `--adults` | `-a` | `1` | Number of adult passengers (1–9) |
| `--children` | | `0` | Number of children (2–11 years) |
| `--cabin` | `-c` | _(any)_ | Cabin class: `M` economy, `W` premium, `C` business, `F` first |
| `--max-stops` | `-s` | `2` | Maximum stopovers per direction (0–4) |
| `--currency` | | `EUR` | 3-letter currency code |
| `--limit` | `-l` | `20` | Maximum number of results (1–100) |
| `--sort` | | `price` | Sort by `price` or `duration` |
| `--json` | `-j` | | Output raw JSON (for agents/scripts) |

### Multi-Passenger Examples

```bash
# Family trip: 2 adults + 2 children, economy
boostedtravel search LHR BCN 2026-07-15 --return 2026-07-22 --adults 2 --children 2 --cabin M

# Business trip: 3 adults, business class, direct flights only
boostedtravel search JFK LHR 2026-05-01 --adults 3 --cabin C --max-stops 0

# Solo round-trip, first class, sorted by duration
boostedtravel search LAX NRT 2026-08-10 --return 2026-08-24 --cabin F --sort duration
```

When you search with multiple passengers, the response includes `passenger_ids` (e.g., `["pas_0", "pas_1", "pas_2"]`). You must provide passenger details for **each** ID when booking.

## Authentication

### 1. Register (one-time, no auth needed)

```bash
# CLI
boostedtravel register --name my-agent --email you@example.com

# cURL
curl -X POST https://api.boostedchat.com/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-agent", "email": "you@example.com"}'

# Response:
# { "agent_id": "ag_xxx", "api_key": "trav_xxxxx...", "message": "..." }
```

### 2. Use the API Key

Every authenticated request requires the `X-API-Key` header:

```bash
# Set as environment variable (recommended)
export BOOSTEDTRAVEL_API_KEY=trav_...

# CLI reads it automatically
boostedtravel search LHR JFK 2026-04-15

# Or pass explicitly
boostedtravel search LHR JFK 2026-04-15 --api-key trav_...

# cURL
curl -X POST https://api.boostedchat.com/api/v1/flights/search \
  -H "X-API-Key: trav_..." \
  -H "Content-Type: application/json" \
  -d '{"origin": "LHR", "destination": "JFK", "date_from": "2026-04-15"}'
```

### 3. Python SDK

```python
from boostedtravel import BoostedTravel

# Option A: Pass directly
bt = BoostedTravel(api_key="trav_...")

# Option B: Read from environment (BOOSTEDTRAVEL_API_KEY)
bt = BoostedTravel()

# Option C: Register inline
creds = BoostedTravel.register("my-agent", "agent@example.com")
bt = BoostedTravel(api_key=creds["api_key"])
```

### 4. Setup Payment (required before unlock)

```bash
boostedtravel setup-payment
# Opens Stripe to attach a payment method to your agent account
```

```python
bt.setup_payment(token="tok_visa")  # Stripe payment token
```

## Error Handling

The SDK raises specific exceptions for each failure mode:

| Exception | HTTP Code | When it happens |
|-----------|-----------|-----------------|
| `AuthenticationError` | 401 | Missing or invalid API key |
| `PaymentRequiredError` | 402 | No payment method set up (call `setup-payment` first) |
| `OfferExpiredError` | 410 | Offer no longer available (search again) |
| `BoostedTravelError` | any | Base class — catches all API errors |

### Python Error Handling

```python
from boostedtravel import (
    BoostedTravel, BoostedTravelError,
    AuthenticationError, PaymentRequiredError, OfferExpiredError,
)

bt = BoostedTravel(api_key="trav_...")

# Search — handle invalid locations
try:
    flights = bt.search("INVALID", "JFK", "2026-04-15")
except BoostedTravelError as e:
    if e.status_code == 422:
        print(f"Invalid location: {e.message}")
        # Resolve the location first
        locations = bt.resolve_location("New York")
        iata = locations[0]["iata_code"]  # "JFK"
        flights = bt.search("LHR", iata, "2026-04-15")
    else:
        raise

# Unlock — handle payment and expiry
try:
    unlocked = bt.unlock(flights.cheapest.id)
except PaymentRequiredError:
    print("Set up payment first: bt.setup_payment('tok_visa')")
except OfferExpiredError:
    print("Offer expired — search again for fresh results")

# Book — handle all errors
try:
    booking = bt.book(
        offer_id=unlocked.offer_id,
        passengers=[{
            "id": flights.passenger_ids[0],
            "given_name": "John",
            "family_name": "Doe",
            "born_on": "1990-01-15",
            "gender": "m",
            "title": "mr",
        }],
        contact_email="john@example.com",
    )
    print(f"Booked! PNR: {booking.booking_reference}")
except OfferExpiredError:
    print("Offer expired after unlock — search again (30min window may have passed)")
except BoostedTravelError as e:
    print(f"Booking failed ({e.status_code}): {e.message}")
```

### CLI Error Handling

The CLI exits with code 1 on errors and prints the message to stderr. Use `--json` for parseable error output:

```bash
# Check exit code in scripts
if ! boostedtravel search INVALID JFK 2026-04-15 --json 2>/dev/null; then
  echo "Search failed — check location codes"
fi
```

## Working with Search Results

Search returns offers from multiple airlines. Each offer includes price, airlines, route, duration, stopovers, and booking conditions:

### Python — Filter and Sort Results

```python
flights = bt.search("LON", "BCN", "2026-04-01", return_date="2026-04-08")

# Access all offers
for offer in flights.offers:
    print(f"{offer.owner_airline}: {offer.currency} {offer.price}")
    print(f"  Route: {offer.outbound.route_str}")
    print(f"  Duration: {offer.outbound.total_duration_seconds // 3600}h")
    print(f"  Stops: {offer.outbound.stopovers}")
    print(f"  Refundable: {offer.conditions.get('refund_before_departure', 'unknown')}")
    print(f"  Changeable: {offer.conditions.get('change_before_departure', 'unknown')}")

# Filter: only direct flights
direct = [o for o in flights.offers if o.outbound.stopovers == 0]

# Filter: only a specific airline
ba_flights = [o for o in flights.offers if "British Airways" in o.airlines]

# Filter: refundable only
refundable = [o for o in flights.offers if o.conditions.get("refund_before_departure") == "allowed"]

# Sort by duration (search already sorts by price by default)
by_duration = sorted(flights.offers, key=lambda o: o.outbound.total_duration_seconds)

# Get the cheapest
cheapest = flights.cheapest
print(f"Best price: {cheapest.price} {cheapest.currency} on {cheapest.owner_airline}")
```

### CLI — JSON Output for Agents

```bash
# Get structured JSON output
boostedtravel search LON BCN 2026-04-01 --return 2026-04-08 --json

# Pipe to jq for filtering
boostedtravel search LON BCN 2026-04-01 --json | jq '[.offers[] | select(.stopovers == 0)]'
boostedtravel search LON BCN 2026-04-01 --json | jq '.offers | sort_by(.duration_seconds) | .[0]'
```

### JSON Response Structure

```json
{
  "passenger_ids": ["pas_0", "pas_1"],
  "total_results": 47,
  "offers": [
    {
      "id": "off_xxx",
      "price": 89.50,
      "currency": "EUR",
      "airlines": ["Ryanair"],
      "owner_airline": "Ryanair",
      "route": "STN → BCN",
      "duration_seconds": 7800,
      "stopovers": 0,
      "conditions": {
        "refund_before_departure": "not_allowed",
        "change_before_departure": "allowed_with_fee"
      },
      "is_locked": false
    }
  ]
}
```

## Resolve Locations Before Searching

Always resolve city names to IATA codes before searching. This avoids errors from invalid or ambiguous location names:

```python
# Resolve a city name
locations = bt.resolve_location("New York")
# Returns: [{"iata_code": "JFK", "name": "John F. Kennedy", "type": "airport", "city": "New York"}, ...]

# Use the IATA code in search
flights = bt.search(locations[0]["iata_code"], "LAX", "2026-04-15")
```

```bash
# CLI
boostedtravel locations "New York"
# Output:
#   JFK  John F. Kennedy International Airport
#   LGA  LaGuardia Airport
#   EWR  Newark Liberty International Airport
#   NYC  New York (all airports)
```

## Complete Search-to-Booking Workflow

Here's a complete, production-ready workflow with proper error handling at each step:

### Python — Full Workflow

```python
from boostedtravel import (
    BoostedTravel, BoostedTravelError,
    AuthenticationError, PaymentRequiredError, OfferExpiredError,
)

def search_and_book(origin_city, dest_city, date, passenger_info, email):
    bt = BoostedTravel()  # reads BOOSTEDTRAVEL_API_KEY from env

    # Step 1: Resolve locations
    origins = bt.resolve_location(origin_city)
    dests = bt.resolve_location(dest_city)
    if not origins or not dests:
        raise ValueError(f"Could not resolve: {origin_city} or {dest_city}")
    origin_iata = origins[0]["iata_code"]
    dest_iata = dests[0]["iata_code"]

    # Step 2: Search (free)
    flights = bt.search(origin_iata, dest_iata, date, sort="price")
    if not flights.offers:
        print(f"No flights found {origin_iata} → {dest_iata} on {date}")
        return None

    print(f"Found {flights.total_results} offers")
    print(f"Cheapest: {flights.cheapest.price} {flights.cheapest.currency}")
    print(f"Passenger IDs: {flights.passenger_ids}")

    # Step 3: Unlock ($1) — confirms price, reserves 30min
    try:
        unlocked = bt.unlock(flights.cheapest.id)
        print(f"Confirmed price: {unlocked.confirmed_currency} {unlocked.confirmed_price}")
    except PaymentRequiredError:
        print("Setup payment first: boostedtravel setup-payment")
        return None
    except OfferExpiredError:
        print("Offer expired — search again")
        return None

    # Step 4: Book (free after unlock)
    # Map passenger_info to each passenger_id from search
    passengers = []
    for i, pid in enumerate(flights.passenger_ids):
        pax = {**passenger_info[i], "id": pid}
        passengers.append(pax)

    try:
        booking = bt.book(
            offer_id=unlocked.offer_id,
            passengers=passengers,
            contact_email=email,
        )
        print(f"Booked! PNR: {booking.booking_reference}")
        return booking
    except OfferExpiredError:
        print("Offer expired — 30min window may have passed, search again")
        return None
    except BoostedTravelError as e:
        print(f"Booking failed: {e.message}")
        return None


# Usage — 2 passengers
search_and_book(
    origin_city="London",
    dest_city="Barcelona",
    date="2026-04-01",
    passenger_info=[
        {"given_name": "John", "family_name": "Doe", "born_on": "1990-01-15", "gender": "m", "title": "mr"},
        {"given_name": "Jane", "family_name": "Doe", "born_on": "1992-03-20", "gender": "f", "title": "ms"},
    ],
    email="john.doe@example.com",
)
```

### Bash — CLI Workflow

```bash
#!/bin/bash
export BOOSTEDTRAVEL_API_KEY=trav_...

# Step 1: Resolve locations
ORIGIN=$(boostedtravel locations "London" --json | jq -r '.[0].iata_code')
DEST=$(boostedtravel locations "Barcelona" --json | jq -r '.[0].iata_code')

# Step 2: Search
RESULTS=$(boostedtravel search "$ORIGIN" "$DEST" 2026-04-01 --adults 2 --json)
OFFER_ID=$(echo "$RESULTS" | jq -r '.offers[0].id')
PAX_IDS=$(echo "$RESULTS" | jq -r '.passenger_ids[]')
echo "Best offer: $OFFER_ID"

# Step 3: Unlock
boostedtravel unlock "$OFFER_ID"

# Step 4: Book (one --passenger per passenger_id)
boostedtravel book "$OFFER_ID" \
  --passenger '{"id":"pas_0","given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m","title":"mr"}' \
  --passenger '{"id":"pas_1","given_name":"Jane","family_name":"Doe","born_on":"1992-03-20","gender":"f","title":"ms"}' \
  --email john.doe@example.com
```

## Minimizing Unlock Costs (Price Aggregation Strategy)

Searching is **completely free** — you can search as many routes, dates, and configurations as you want without cost. The $1 unlock fee is only charged when you confirm a specific offer. Here's how to minimize costs:

### Strategy 1: Search Wide, Unlock Narrow

```python
# Search multiple dates — FREE
dates = ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"]
all_offers = []
for date in dates:
    result = bt.search("LON", "BCN", date)
    all_offers.extend([(date, o) for o in result.offers])

# Compare across all dates — still FREE
all_offers.sort(key=lambda x: x[1].price)
best_date, best_offer = all_offers[0]
print(f"Cheapest is {best_offer.price} {best_offer.currency} on {best_date}")

# Only unlock the winner — $1
unlocked = bt.unlock(best_offer.id)
```

### Strategy 2: Filter Before Unlocking

```python
# Search returns full details (airline, duration, conditions) for FREE
flights = bt.search("LHR", "JFK", "2026-06-01", limit=50)

# Apply all filters BEFORE paying $1
candidates = [
    o for o in flights.offers
    if o.outbound.stopovers == 0                          # Direct only
    and o.outbound.total_duration_seconds < 10 * 3600     # Under 10 hours
    and "British Airways" in o.airlines                    # Specific airline
    and o.conditions.get("change_before_departure") != "not_allowed"  # Changeable
]

if candidates:
    # Unlock only the best match
    best = min(candidates, key=lambda o: o.price)
    unlocked = bt.unlock(best.id)
```

### Strategy 3: Use the 30-Minute Window

After unlocking, the confirmed price is held for **30 minutes**. Use this window to:
- Present results to the user for decision
- Verify passenger details
- Complete the booking without re-searching

```python
# Unlock at minute 0
unlocked = bt.unlock(offer_id)
# ... user reviews details, confirms passenger info ...
# Book within 30 minutes — no additional search or unlock needed
booking = bt.book(offer_id=unlocked.offer_id, passengers=[...], contact_email="...")
```

### Key Rules for Cost Management

| Action | Cost | Notes |
|--------|------|-------|
| Search | FREE | Unlimited. Search as many routes/dates as you want |
| Resolve location | FREE | Unlimited |
| View offer details | FREE | All details (price, airline, duration, conditions) returned in search |
| Unlock | $1 | Confirms price, holds for 30 minutes |
| Book | FREE | After unlock — creates real airline PNR |
| Re-search same route | FREE | Prices may change (real-time airline data) |

## Building an AI Agent with BoostedTravel

Guidelines for building autonomous AI agents that search, evaluate, and book flights:

### Architecture

```
User request → Agent parses intent → Resolve locations → Search (free)
  → Filter & rank offers → Present to user → Unlock best ($1) → Book (free)
```

### Agent Best Practices

1. **Always resolve locations first.** City names are ambiguous — "London" could be LHR, LGW, STN, LCY, or LTN. Use `resolve_location()` to get IATA codes, then let the user confirm if multiple options exist.

2. **Search is free — use it liberally.** Search multiple dates, multiple origin/destination pairs, different cabin classes. Build a complete picture before spending $1 on unlock.

3. **Understand the 30-minute expiration.** After unlocking, you have 30 minutes to book. If the window expires, you must search again (free) and unlock again ($1). Plan your workflow to minimize the gap between unlock and book.

4. **Handle price changes gracefully.** Search prices are real-time snapshots. The unlock step confirms the actual current price with the airline. If the confirmed price differs significantly from the search price, inform the user before proceeding to book.

5. **Map passenger IDs correctly.** Search returns `passenger_ids` (e.g., `["pas_0", "pas_1"]`). When booking with multiple passengers, each passenger dict must include the correct `id` from this list. The first adult gets `pas_0`, second gets `pas_1`, etc.

6. **Use REAL passenger details.** Airlines send e-tickets to the contact email. Names must match the passenger's passport or government ID. Never use placeholder data.

### Handling Edge Cases

```python
# Retry on expired offers
def resilient_book(bt, origin, dest, date, passengers, email, max_retries=2):
    for attempt in range(max_retries + 1):
        flights = bt.search(origin, dest, date)
        if not flights.offers:
            return None

        try:
            unlocked = bt.unlock(flights.cheapest.id)
            booking = bt.book(
                offer_id=unlocked.offer_id,
                passengers=[{**p, "id": pid} for p, pid in zip(passengers, flights.passenger_ids)],
                contact_email=email,
            )
            return booking
        except OfferExpiredError:
            if attempt < max_retries:
                print(f"Offer expired, retrying ({attempt + 1}/{max_retries})...")
                continue
            raise
        except PaymentRequiredError:
            print("Payment method not set up — call bt.setup_payment()")
            raise

# Compare prices across dates intelligently
def find_cheapest_date(bt, origin, dest, dates):
    """Search multiple dates (free) and return the cheapest option."""
    best = None
    for date in dates:
        try:
            result = bt.search(origin, dest, date)
            if result.offers and (best is None or result.cheapest.price < best[1].price):
                best = (date, result.cheapest, result.passenger_ids)
        except BoostedTravelError:
            continue  # Skip dates with no routes
    return best  # (date, offer, passenger_ids) or None
```

## Packages

| Package | Install | What it is |
|---------|---------|------------|
| **Python SDK + CLI** | `pip install boostedtravel` | SDK + `boostedtravel` CLI command |
| **JS/TS SDK + CLI** | `npm install -g boostedtravel` | SDK + `boostedtravel` CLI command |
| **MCP Server** | `npx boostedtravel-mcp` | Model Context Protocol for Claude, Cursor, etc. |

## ⚠️ Important: Real Passenger Details

When booking, you **must** use the real passenger's email and legal name. The airline sends e-tickets directly to the email provided. Placeholder or fake data will cause booking failures or the passenger won't receive their ticket.

## API Docs

- **OpenAPI/Swagger:** https://api.boostedchat.com/docs
- **Agent discovery:** https://api.boostedchat.com/.well-known/ai-plugin.json
- **Agent manifest:** https://api.boostedchat.com/.well-known/agent.json
- **LLM instructions:** https://api.boostedchat.com/llms.txt

## Links

- **PyPI:** https://pypi.org/project/boostedtravel/
- **npm (JS SDK):** https://www.npmjs.com/package/boostedtravel
- **npm (MCP):** https://www.npmjs.com/package/boostedtravel-mcp

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting issues and pull requests.

## Security

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## For AI Agents

See [AGENTS.md](AGENTS.md) for agent-specific instructions, or [CLAUDE.md](CLAUDE.md) for codebase context.

## License

[MIT](LICENSE)
