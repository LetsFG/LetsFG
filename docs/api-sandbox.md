# Sandbox Environment

Test your integration without consuming prepaid balance or firing real connectors.
The sandbox mirrors the full Developer API surface — same endpoints, same request
schema, same response schema — but returns realistic fake data instantly.

## Base URL

```
https://letsfg.co/developers/api/v1/sandbox/
```

Add `sandbox/` between `v1/` and the endpoint name. Your API key and all headers
stay the same.

| Real endpoint | Sandbox equivalent |
|---|---|
| `POST /v1/flights/search` | `POST /v1/sandbox/flights/search` |
| `POST /v1/flights/multi-search` | `POST /v1/sandbox/flights/multi-search` |
| `POST /v1/flights/parse-query` | `POST /v1/sandbox/flights/parse-query` |
| `GET /v1/flights/locations/{q}` | `GET /v1/sandbox/flights/locations/{q}` |

## Sandbox search example

```bash
curl -X POST https://letsfg.co/developers/api/v1/sandbox/flights/search \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "origin": "JFK",
    "destination": "LAX",
    "date_from": "2026-07-15",
    "adults": 1,
    "currency": "USD"
  }'
```

Response is identical in structure to a live search — `offers[]`, `passenger_ids`,
`airlines_summary`, `total_results`, etc. — but `source_tier` is `"sandbox"` and
`pricing_note` confirms no charge was applied.

## Deterministic results

Sandbox results are seeded on `(origin, destination, date_from)`. The same query
always returns the same set of offers, so your tests are reproducible across runs.

## What's different

| Behaviour | Live | Sandbox |
|---|---|---|
| Connectors fired | Yes (180+) | No |
| Credits charged | Yes (1 per search) | No |
| Response time | 60–90 s | < 1 s |
| `booking_url` | Real airline link | Placeholder |
| `parse-query` NL accuracy | Full Gemini parse | Stub (returns missing fields) |
| `total_results` | Real count | Fake large number (~800–1 800) |

## Using `departure_time_from` / `departure_time_to`

Time-window filters work in sandbox exactly as in production — offers outside the
window are excluded before returning. Use this to verify your filter logic before
going live.

```json
{
  "origin": "JFK",
  "destination": "LAX",
  "date_from": "2026-07-15",
  "departure_time_from": "05:00",
  "departure_time_to": "11:00"
}
```

## Multi-search in sandbox

```bash
curl -X POST https://letsfg.co/developers/api/v1/sandbox/flights/multi-search \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "origin": "JFK",
    "destinations": ["LAX", "MIA", "ORD", "DFW", "SEA"],
    "date_from": "2026-07-15",
    "currency": "USD"
  }'
```

All destinations run in under a second. `charged_searches: 0` in the summary
confirms no credits were used.

## Typical integration workflow

1. Build and test your full integration against the sandbox — iterate freely, no cost.
2. Verify that your code correctly reads `offers`, `passenger_ids`, and `airlines_summary`.
3. Confirm your `departure_time_from`/`to` filter logic returns the expected subset.
4. Switch to production endpoints (drop `sandbox/` from the path) when ready.
5. Credits are only consumed by production searches.
