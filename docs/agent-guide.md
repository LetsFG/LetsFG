# Building AI Agents with LetsFG

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

Guidelines for building autonomous AI agents that search, evaluate, and book flights. Works with OpenClaw, Perplexity Computer, Claude, Cursor, Windsurf, and any MCP-compatible agent framework.

> 🎬 **[Watch the demo](https://github.com/LetsFG/LetsFG#demo-lfg-vs-default-agent-search)** — side-by-side comparison of default agent search vs LetsFG.

## Search

All search runs server-side at letsfg.co. Authenticate once with `letsfg auth` (a zero-amount card setup (nothing charged), 90-day Bearer token) or use a prepaid Developer API key.

```python
# PFS search — free Bearer token, server-side, 8-10 s to first results
from letsfg import LetsFG
bt = LetsFG()  # uses LETSFG_BEARER_TOKEN from environment
result = bt.search("LHR", "JFK", "2026-06-01")

# Developer API — prepaid credits, direct booking URLs, no per-booking fee
bt = LetsFG(api_key="letsfg_...")
result = bt.search("LHR", "JFK", "2026-06-01")
```

**When to use PFS (Bearer token):** This is the agent path — search and booking. Auth is a zero-amount card setup; nothing is charged. 8–10 s to first results per search. Run `letsfg auth` once.

**When to use Developer API:** Managed cloud search, billing controls, volume usage, and direct airline URLs with no per-booking fee. Register at [letsfg.co/developers](https://letsfg.co/developers). It is also the **only** way to reach hotels.

### Hotels

```python
lfg = LetsFG(api_key="letsfg_...")          # Bearer tokens do NOT work for hotels
city  = lfg.hotel_destinations("Warsaw")[0]
stays = lfg.search_hotels(city_id=city["Id"], city_name=city["Name"],
                          check_in="2026-11-10", check_out="2026-11-12", adults=2)
booking = lfg.book_hotel_and_wait(...)     # async: returns a job, polls to completion
print(booking["confirmation"], booking["pay_link"])
```

Only free-cancellation, pay-later rates are sold. Booking charges 5% to the card on file as a
non-refundable reservation fee; the balance goes straight to the supplier through `pay_link` by
`balance_due_by`. A card is required for hotel **search** as well as booking. Full detail:
[Hotels](hotels.md).

## Architecture

```
User request → Agent parses intent → Resolve locations → Search (local free or public prepaid)
    → Filter & rank offers → Present to user → Book
        (PFS: book directly, free, no unlock step — Developer API: unlock, then book)
```

## Agent Best Practices

1. **Always resolve locations first.** City names are ambiguous — "London" could be LHR, LGW, STN, LCY, or LTN. Use `resolve_location()` to get IATA codes, then let the user confirm if multiple options exist.

2. **Search is free on PFS.** Search multiple dates and variants freely with a Bearer token. If you are using the Developer API, remember that search consumes prepaid balance, so batch intentionally.

3. **Book promptly.** On PFS, offers expire ~15 minutes after search — book while it's still fresh, or search again. On the Developer API, you have 30 minutes after unlocking to book before you need a fresh unlock.

4. **Handle price changes gracefully.** Search prices are real-time snapshots. On PFS, `book()` itself surfaces the outcome directly — a confirmed order or a booking link, never a silent mismatch. On the Developer API, the unlock step confirms the actual current price with the airline; inform the user if it differs significantly from the search price before proceeding to book.

5. **Map passenger IDs correctly.** Search returns `passenger_ids` (e.g., `["pas_0", "pas_1"]`). When booking with multiple passengers, each passenger dict must include the correct `id` from this list. The first adult gets `pas_0`, second gets `pas_1`, etc.

6. **Use REAL passenger details.** Airlines send e-tickets to the contact email. Names must match the passenger's passport or government ID. Never use placeholder data.

7. **Search is async, and `completed` is not the end.** The engine returns in 8–10 s to first results. Poll `GET /api/results/<search_id>` immediately and then every 2 s — do not sleep before the first poll, or you put a floor under a search that is already faster than it.

   A search reports `status: "completed"` **before its offer set stops growing**. The split-ticket probe runs two extra connector fan-outs and merges its result in afterwards, so the cheapest itinerary on the search is often one that does not exist yet at the moment the status turns terminal. The response carries `split_ticket_pending` (and `gf_enrich_pending` for the Google Flights enrich) while that is still inbound.

   **Keep polling while either flag is true.** Stopping at `completed` is how you silently discard the cheapest offer. Bound the wait — a flag that never clears must not hang your agent — and take whatever has landed when the bound expires. The official SDKs and the MCP server do this for you. Most searches never fire the probe at all, so the flags are usually already false on the first poll and this costs nothing.

## Handling Edge Cases

```python
from letsfg import LetsFG, LetsFGError

# Retry on expired offers. bt.book() dispatches to the free PFS path
# (POST /api/agent-book) if a Bearer token is set, otherwise falls back to
# the Developer API (unlock required first) — same call either way.
def resilient_book(bt, origin, dest, date, passenger, email, max_retries=2):
    for attempt in range(max_retries + 1):
        flights = bt.search(origin, dest, date)
        if not flights.offers:
            return None

        try:
            result = bt.book(
                offer_id=flights.cheapest.id,
                passengers=[passenger],
                contact_email=email,
                search_id=flights.search_id,  # PFS path only; ignored on Developer API
            )
            return result
        except LetsFGError as e:
            if e.is_retryable and attempt < max_retries:
                import time; time.sleep(2 ** attempt)
                continue
            raise

# On the PFS path, result is a dict: either {"ok": True, "booked": True,
# "order_id": ...} or {"ok": False, "booked": False, "booking_url": ...} — the
# latter is a normal outcome (nothing charged), not an error. Don't retry the
# same offer; hand the user the booking_url.

# Compare prices across dates intelligently
def find_cheapest_date(bt, origin, dest, dates):
    """Search multiple dates (free) and return the cheapest option."""
    best = None
    for date in dates:
        try:
            result = bt.search(origin, dest, date)
            if result.offers and (best is None or result.cheapest.price < best[1].price):
                best = (date, result.cheapest, result.passenger_ids)
        except LetsFGError:
            continue  # Skip dates with no routes
    return best  # (date, offer, passenger_ids) or None
```

## Rate Limits and Timeouts

The API has rate limits to ensure fair usage and protect airline endpoints.

| Endpoint | Rate Limit | Timeout |
|----------|-----------|--------|
| Search (MCP) | **10 req/min** per IP | 180s (airline APIs can be slow) |
| Search (API) | 60 req/min per agent | 30s |
| Resolve location | 120 req/min per agent | 5s |
| Unlock | 20 req/min per agent | 15s |
| Book | 10 req/min per agent | 30s |

> **MCP search rate limit:** The MCP server uses cloud-based search which is rate limited to **10 requests per minute** per IP address. The server returns `rate_limit` info in every search response so you can track remaining quota. If you hit the limit, you'll get a 429 response with a `retry_after` value.

### Programmatic access requires a Bearer token

The letsfg.co website is for human users and is protected by Cloudflare Turnstile — plain HTTP requests or headless scripts cannot search it. Any agent or script that calls LetsFG directly must hold a **90-day Bearer token**, obtained by putting a payment method on file.

**Nothing is charged for this.** It is a zero-amount Stripe setup: the card is validated and vaulted, with no charge and no authorization hold. Having a card on file is what lets your agent go all the way to booking. This replaced the Twitter/X challenge on 2026-07-29.

Once authenticated, use `POST /api/search` (natural language or structured) instead of `GET /en?q=...`.

```bash
# 1. Ask how to enrol (no auth required)
curl -X POST https://letsfg.co/api/agent-access/request
# → 402 {"setup_url":"https://checkout.stripe.com/c/pay/cs_...",
#        "setup_session_id":"cs_...","charged":false}

# 2a. A human opens setup_url and adds a card, then:
curl -X POST https://letsfg.co/api/agent-access/verify \
  -H "Content-Type: application/json" \
  -d '{"setup_session_id":"cs_..."}'

# 2b. OR fully headless — mint a single-use card token against the LetsFG
#     publishable key, then:
curl -X POST https://letsfg.co/api/agent-access/verify \
  -H "Content-Type: application/json" \
  -d '{"card_token":"tok_..."}'
# → {"token":"eyJ...","payer":"card:abc123","expires_at":"...","charged":false}

# 3. Search with Bearer token (NL query)
curl -X POST https://letsfg.co/api/search \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"query":"London to Barcelona June 15 2026"}'
# → {"search_id":"ws_abc123","status":"searching","parsed":{...}}

# 4. Poll for results
curl https://letsfg.co/api/results/ws_abc123 \
  -H "Authorization: Bearer eyJ..."
```

`payment_method_id` (pm_...) is accepted ONLY for a card already enrolled through this flow — a bare pm_ id is not proof that you control the card. For a first headless enrolment use `card_token` (tok_...), which you mint against the LetsFG publishable key.

Token is valid for 90 days; one active token per card. Renew by running `letsfg auth` again.
Full walkthrough: https://letsfg.co/for-agents

### Booking

```bash
curl -X POST https://letsfg.co/api/agent-book \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"search_id":"ws_abc123","offer_id":"ws_off_...",
       "contact_email":"traveller@example.com",
       "passenger":{"given_name":"Ada","family_name":"Lovelace",
                    "born_on":"1990-04-01","gender":"f","phone_number":"+15551234567"}}'
```

Two outcomes, both with `"charged": 0`:

- `{"booked": true, "order_id": "..."}` — booked.
- `{"booked": false, "booking_url": "..."}` — the booking genuinely did not
  complete and nothing was charged. **This is a normal outcome, not a transient
  error.** Retrying will not book it. Hand the user `booking_url`; it goes to
  that exact offer.

One passenger per call.

Handle rate limits and timeouts in production:

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
            if "rate limit" in str(e).lower() or "429" in str(e):
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

## Advanced Preference Evaluation

Rather than always picking the cheapest flight, score offers by weighted criteria:

```python
def score_offer(offer, preferences=None):
    """Score a flight offer by multiple criteria (lower = better).
    
    preferences: dict with weights, e.g.:
        {"price": 0.4, "duration": 0.3, "stops": 0.2, "airline_pref": 0.1}
    """
    prefs = preferences or {"price": 0.4, "duration": 0.3, "stops": 0.2, "airline_pref": 0.1}
    preferred_airlines = {"British Airways", "Delta", "United", "Lufthansa"}
    
    # Normalize factors (0-1 scale, lower is better)
    price_score = offer.price / 2000        # Normalize against $2000 baseline
    duration_hours = offer.outbound.total_duration_seconds / 3600
    duration_score = duration_hours / 24    # Normalize against 24h baseline
    stops_score = offer.outbound.stopovers / 3  # Normalize against 3 stops
    airline_score = 0 if any(a in preferred_airlines for a in offer.airlines) else 1
    
    return (
        prefs["price"] * price_score +
        prefs["duration"] * duration_score +
        prefs["stops"] * stops_score +
        prefs["airline_pref"] * airline_score
    )

# Usage: find best offer considering multiple criteria
flights = bt.search("LHR", "JFK", "2026-06-01", limit=50)
best = min(flights.offers, key=lambda o: score_offer(o, {
    "price": 0.3,      # Price matters, but not everything
    "duration": 0.4,    # Shortest travel time is priority
    "stops": 0.2,       # Prefer direct flights
    "airline_pref": 0.1 # Slight preference for known airlines
}))
print(f"Best overall: {best.airlines[0]} ${best.price} — {best.outbound.stopovers} stops")
```

## Data Persistence for Price Tracking

For agents that track prices over time or compare across sessions:

```python
import json
from datetime import datetime
from pathlib import Path

CACHE_FILE = Path("flight_price_history.json")

def load_price_history():
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text())
    return {}

def save_search_result(origin, dest, date, result):
    """Save search results for later comparison."""
    history = load_price_history()
    key = f"{origin}-{dest}-{date}"
    if key not in history:
        history[key] = []
    history[key].append({
        "searched_at": datetime.utcnow().isoformat(),
        "cheapest_price": result.cheapest.price if result.offers else None,
        "total_offers": result.total_results,
        "airlines": list(set(a for o in result.offers[:5] for a in o.airlines)),
    })
    CACHE_FILE.write_text(json.dumps(history, indent=2))

def get_price_trend(origin, dest, date):
    """Check if prices are rising or falling for a route."""
    history = load_price_history()
    key = f"{origin}-{dest}-{date}"
    entries = history.get(key, [])
    if len(entries) < 2:
        return "insufficient_data"
    prices = [e["cheapest_price"] for e in entries if e["cheapest_price"]]
    if prices[-1] < prices[0]:
        return f"falling (${prices[0]} → ${prices[-1]})"
    return f"rising (${prices[0]} → ${prices[-1]})"
```
