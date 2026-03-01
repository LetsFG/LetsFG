# SKILL.md — BoostedTravel Capabilities

> Machine-readable skill manifest for AI agents and documentation indexers.

## Identity

- **Name:** BoostedTravel
- **Type:** API + SDK + MCP Server + CLI
- **Purpose:** Agent-native flight search, hotel search, and booking
- **API Base URL:** `https://api.boostedchat.com`
- **MCP Endpoint:** `https://api.boostedchat.com/mcp` (Streamable HTTP)
- **Packages:** PyPI `boostedtravel` · npm `boostedtravel` · npm `boostedtravel-mcp`
- **License:** MIT

## Skills

### search_flights
Search 400+ airlines worldwide via NDC and GDS. Returns real-time prices with zero markup or bias — $20–50 cheaper than OTAs.
- **Cost:** FREE (unlimited)
- **Input:** origin (IATA), destination (IATA), date_from, optional: date_to, return_from, return_to, adults, children, infants, cabin_class (M/W/C/F), max_stopovers, currency, sort, limit
- **Output:** List of flight offers with price, airlines, times, segments, conditions, passenger_ids
- **Note:** All offers are locked. Must unlock before booking.

### search_hotels
Search 300,000+ hotels worldwide via Amadeus GDS + Hotelbeds B2B wholesale net rates.
- **Cost:** FREE
- **Input:** location (city name or IATA), checkin, checkout, adults, children, rooms, min_stars, max_price, currency, sort, limit
- **Output:** List of hotel offers with name, address, stars, rating, photos, rooms, prices, cancellation policies

### search_transfers
Search ground transfers — private cars, taxis, shared shuttles, airport express.
- **Cost:** FREE
- **Input:** origin, destination, date, passengers
- **Output:** Transfer options with prices and vehicle types

### search_activities
Search 300,000+ activities — tours, museum tickets, day trips via Amadeus + Hotelbeds wholesale.
- **Cost:** FREE
- **Input:** location, date_from, date_to
- **Output:** Activity options with prices, descriptions, availability

### resolve_location
Resolve city names to IATA airport/city codes.
- **Cost:** FREE
- **Input:** query (city name, e.g. "London")
- **Output:** List of matching IATA codes (e.g. LON, LHR, LGW, STN, LTN, LCY)

### unlock_flight_offer
Confirm live price with airline and reserve offer for 30 minutes.
- **Cost:** $1.00 (Stripe)
- **Input:** offer_id from search results
- **Output:** confirmed_price, confirmed_currency, offer_expires_at

### book_flight
Create a real airline reservation with PNR code. FREE after unlock.
- **Cost:** FREE (after $1 unlock)
- **Input:** offer_id, passengers (id, given_name, family_name, born_on, gender, title, email, phone_number), contact_email
- **Output:** booking_reference (airline PNR), status, flight_price, currency
- **CRITICAL:** Use real passenger names (must match passport/ID) and real email (airline sends e-ticket there)

### hotel_checkrate
Confirm hotel rate before booking (required if rate_type=RECHECK).
- **Cost:** FREE
- **Input:** rate_keys from hotel search
- **Output:** Confirmed price, board type, cancellation policy, rate comments

### hotel_book
Book a hotel room.
- **Cost:** Room price (charged via Hotelbeds)
- **Input:** holder_name, holder_surname, rooms with rate_key and paxes
- **Output:** reference, status, hotel details, total_net

### hotel_voucher
Get guest voucher for hotel check-in.
- **Cost:** FREE
- **Input:** booking reference
- **Output:** Hotel name, dates, room type, board, payment notice

### hotel_cancel
Cancel a hotel booking or simulate cancellation.
- **Cost:** Depends on cancellation policy
- **Input:** reference, simulate (true/false)
- **Output:** cancellation_amount, currency, status

### register
Register a new AI agent.
- **Cost:** FREE
- **Input:** agent_name, email
- **Output:** api_key (permanent credential)

### setup_payment
Attach a payment card for booking (Stripe).
- **Cost:** FREE
- **Input:** token (e.g. "tok_visa") or payment_method_id or card details
- **Output:** Payment status confirmation

### get_agent_profile
Get current agent's profile, usage stats, and payment status.
- **Cost:** FREE
- **Output:** Agent details, search count, booking count, payment status

## Authentication

All endpoints except `register` require an `X-API-Key` header.

```
X-API-Key: trav_...
```

Get your key by calling `POST /api/v1/agents/register` with agent_name and email. The key is permanent — save it once.

After registration, attach a payment card via `POST /api/v1/agents/setup-payment` before you can unlock/book.

## Complete Workflow

### Flight Booking (5 API calls)

```
1. POST /api/v1/agents/register        → Get API key (once)
2. POST /api/v1/agents/setup-payment   → Attach card (once)
3. POST /api/v1/flights/search         → Search flights (FREE)
4. POST /api/v1/bookings/unlock        → Unlock offer ($1)
5. POST /api/v1/bookings/book          → Book flight (FREE)
```

### Hotel Booking (6 API calls)

```
1. POST /api/v1/agents/register        → Get API key (once)
2. POST /api/v1/agents/setup-payment   → Attach card (once)
3. POST /api/v1/hotels/search          → Search hotels (FREE)
4. POST /api/v1/hotels/checkrate       → Confirm price (if rate_type=RECHECK)
5. POST /api/v1/hotels/book            → Book room
6. GET  /api/v1/hotels/voucher/{ref}   → Get guest voucher
```

## CLI Usage

```bash
pip install boostedtravel

boostedtravel register --name my-agent --email me@example.com
export BOOSTEDTRAVEL_API_KEY=trav_...

# Search flights
boostedtravel search LHR JFK 2026-04-15
boostedtravel search LON BCN 2026-04-01 --return 2026-04-08 --cabin C --sort price
boostedtravel search GDN BER 2026-05-10 --adults 2 --children 1

# Resolve locations
boostedtravel locations "New York"

# Unlock and book
boostedtravel unlock off_xxx
boostedtravel book off_xxx \
  --passenger '{"id":"pas_0","given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m","title":"mr"}' \
  --email john.doe@example.com

# Machine-readable output
boostedtravel search GDN BER 2026-03-03 --json
```

## Python SDK Usage

```python
from boostedtravel import BoostedTravel

bt = BoostedTravel(api_key="trav_...")

# Search
results = bt.search_flights(origin="LHR", destination="JFK", date_from="2026-04-15")
for offer in results.offers:
    print(f"{offer.price} {offer.currency} — {', '.join(offer.airlines)}")

# Unlock
unlocked = bt.unlock_offer(offer_id=results.offers[0].id)
print(f"Confirmed: {unlocked.confirmed_price} {unlocked.confirmed_currency}")

# Book
booking = bt.book_flight(
    offer_id=results.offers[0].id,
    passengers=[{
        "id": results.passenger_ids[0],
        "given_name": "John",
        "family_name": "Doe",
        "born_on": "1990-01-15",
        "gender": "m",
        "title": "mr",
        "email": "john@example.com",
        "phone_number": "+447123456789",
    }],
    contact_email="john@example.com",
)
print(f"PNR: {booking.booking_reference}")
```

## MCP Server Setup

```json
{
  "mcpServers": {
    "boostedtravel": {
      "url": "https://api.boostedchat.com/mcp",
      "headers": {
        "X-API-Key": "trav_..."
      }
    }
  }
}
```

Or run locally:

```bash
npm install -g boostedtravel-mcp
BOOSTEDTRAVEL_API_KEY=trav_... boostedtravel-mcp
```

## MCP Tools

| Tool | Description | Cost |
|------|-------------|------|
| `search_flights` | Search 400+ airlines worldwide | FREE |
| `resolve_location` | City name → IATA code | FREE |
| `unlock_flight_offer` | Confirm price, reserve 30min | $1 |
| `book_flight` | Create real airline reservation | FREE |
| `setup_payment` | Attach payment card (once) | FREE |
| `get_agent_profile` | View usage stats | FREE |

## Search Flags Reference

| Flag | API Field | Values | Default |
|------|-----------|--------|---------|
| `--adults` | `adults` | 1–9 | 1 |
| `--children` | `children` | 0–9 | 0 |
| `--infants` | `infants` | 0–9 | 0 |
| `--cabin` | `cabin_class` | M (economy), W (premium), C (business), F (first) | M |
| `--return` | `return_from` | YYYY-MM-DD | — |
| `--max-stops` | `max_stopovers` | 0–4 | 2 |
| `--sort` | `sort` | price, duration, best_per_airline | price |
| `--limit` | `limit` | 1–200 | 50 |
| `--currency` | `currency` | EUR, USD, GBP, etc. | EUR |
| `--json` | — | Output as JSON | — |

## Error Handling

| Exception | HTTP Code | When |
|-----------|-----------|------|
| `AuthenticationError` | 401 | Invalid or missing API key |
| `PaymentRequired` | 402 | No payment method attached |
| `OfferExpired` | 410 | Offer no longer available |
| `ValidationError` | 422 | Invalid request parameters |
| `RateLimitError` | 429 | Too many requests |
| `ProviderError` | 502 | Upstream airline/hotel API error |

## Pricing Summary

| Action | Cost |
|--------|------|
| Search (flights, hotels, transfers, activities) | **Free** |
| Resolve locations | **Free** |
| Register agent | **Free** |
| Setup payment | **Free** |
| View profile | **Free** |
| Unlock offer | **$1.00** |
| Book flight (after unlock) | **Free** |
| Hotel booking | Room price only |
| Hotel cancellation | Per cancellation policy |

## Key Facts

- 400+ airlines via NDC and GDS (Duffel)
- 300,000+ hotels via Amadeus GDS + Hotelbeds B2B
- 300,000+ activities via Amadeus + Hotelbeds wholesale
- Zero price bias — no demand inflation, no cookie tracking
- $20–50 cheaper than OTAs on average
- Real airline PNR codes and hotel confirmations
- E-tickets sent directly to passenger email
- Search is always free and unlimited
- Only fee: $1 unlock per flight offer
- API designed for machines, not browsers
