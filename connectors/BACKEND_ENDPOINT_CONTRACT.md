# Backend endpoint contract: `/api/v1/flights/date-grid`

This is the contract the website's `/api/date-grid` route expects from the
backend. When the backend exposes this endpoint, the website will use it
automatically — no website changes needed.

## Request

```
POST {LETSFG_API_URL}/api/v1/flights/date-grid
Content-Type: application/json
{LetsFG website API headers}

{
  "origin":      "GDN",            // string, 3-letter IATA, required
  "destination": "LTN",            // string, 3-letter IATA, required
  "dep":         "2026-06-10",     // string, ISO date YYYY-MM-DD, required
  "ret":         "2026-06-14"      // string, ISO date YYYY-MM-DD, optional (null = one-way)
}
```

## Response — 200 OK

```jsonc
{
  "origin":            "GDN",
  "destination":       "LTN",
  "currency":          "PLN",                 // ISO 4217 from Google Flights, may be null on failure
  "selected_outbound": "2026-06-10",
  "selected_return":   "2026-06-14",          // null for one-way
  "scraped_at":        "2026-05-25T15:07:30Z", // ISO 8601 UTC
  "grid": [
    {
      "outbound":   "2026-06-07",  // ISO date
      "return":     "2026-06-11",
      "price":      578,           // integer in currency above
      "currency":   "PLN",         // duplicated per-cell for client convenience
      "is_cheaper": false          // true when Google flags the cell as "good price"
    }
    // ... up to 49 cells (7 outbound × 7 return)
    // "no flights" cells are omitted, not included with null price
  ]
}
```

## Implementation

Wrap the existing Python connector:

```python
from connectors.google_flights import GoogleFlightsClient

async def date_grid_handler(req):
    client = GoogleFlightsClient(headless=True)
    try:
        result = await client.scrape_date_grid(
            origin=req["origin"],
            destination=req["destination"],
            dep_date=req["dep"],
            ret_date=req.get("ret"),
        )
    finally:
        await client.close()

    return {
        "origin": result.origin,
        "destination": result.destination,
        "currency": result.currency,
        "selected_outbound": result.selected_outbound.isoformat(),
        "selected_return": result.selected_return.isoformat() if result.selected_return else None,
        "scraped_at": result.scraped_at.isoformat(),
        "grid": [
            {
                "outbound": c.outbound_date.isoformat(),
                "return": c.return_date.isoformat(),
                "price": c.price,
                "currency": c.currency,
                "is_cheaper": c.is_cheaper,
            }
            for c in result.grid
        ],
    }
```

## Error responses

| Status | When                                     | Body                              |
|--------|------------------------------------------|-----------------------------------|
| 400    | Missing/invalid origin/destination/dep   | `{"error": "validation message"}` |
| 503    | Connector failed, no grid produced       | `{"error": "scrape failed"}`      |
| 504    | Took longer than the upstream timeout    | `{"error": "timeout"}`            |

The website treats anything non-200 as "no live data" and falls back to a
graceful message ("Couldn't pull live prices right now — pick what works for you.").

## Caching note

**The website intentionally does NOT cache these responses** (per design
decision — the refine page shows snapshot-in-time prices, freshness matters
more than cost on this one screen). If the backend wants to do its own
short-lived cache (e.g., 5 minutes per route+dates tuple), that's fine —
the website won't notice.

## Local dev fallback

For website devs without a backend, the website route
(`app/api/date-grid/route.ts`) has a Python-subprocess fallback gated by
`LETSFG_DEV_DATE_GRID_PY=1`. It invokes
`website/scripts/date_grid_runner.py` directly — same connector, no backend
needed. This is dev-only; remove the flag in production.
