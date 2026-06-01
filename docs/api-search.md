# Search and Results

<div class="docs-callout">
  <strong>Paid search rule:</strong> the public developer API search endpoint consumes prepaid balance. Use local search when you want broad free exploration, and use the public API when you want managed cloud search behind the website-owned contract.
</div>

## Endpoints you will use

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/flights/locations/{query}` | GET | Resolve a city, airport, or metro area to IATA codes |
| `/flights/search` | POST | Run paid public search |
| `/flights/providers` | GET | Inspect the provider mix exposed through the public API |

## Resolve locations first

Always resolve ambiguous place names before you search.

```bash
curl https://letsfg.co/developers/api/v1/flights/locations/London \
  -H "X-API-Key: trav_your_api_key"
```

Use metro codes such as `LON` when you want all airports in a city, or specific airport codes such as `LHR` when the integration should be strict.

## Search request fields

| Field | Required | Notes |
|-------|----------|-------|
| `origin` | Yes | IATA departure code such as `LON`, `LHR`, or `JFK` |
| `destination` | Yes | IATA arrival code such as `BCN` or `LAX` |
| `date_from` | Yes | Departure date in `YYYY-MM-DD` |
| `date_to` | No | End of an outbound date window |
| `return_from` | No | Return date for round-trips |
| `return_to` | No | End of a return date window |
| `adults` | No | `1` to `9`, default `1` |
| `children` | No | `0` to `9` |
| `infants` | No | `0` to `9` |
| `cabin_class` | No | `M`, `W`, `C`, or `F` |
| `max_stopovers` | No | `0` to `4`, default `2` |
| `currency` | No | Three-letter code, default `EUR` |
| `locale` | No | Locale code, default `en` |
| `limit` | No | `1` to `200`, default `50` |
| `sort` | No | Public API passes the value through; default `price` |
| `departure_time_from` | No | `HH:MM`, 24-hour format |
| `departure_time_to` | No | `HH:MM`, 24-hour format |
| `provider_filters` | No | Provider filter object for advanced integrations |

## Single-date search example

```bash
curl -X POST https://letsfg.co/developers/api/v1/flights/search \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "origin": "LON",
    "destination": "BCN",
    "date_from": "2026-07-15",
    "adults": 1,
    "currency": "EUR",
    "limit": 20,
    "sort": "price"
  }'
```

## JavaScript example

```ts
const response = await fetch("https://letsfg.co/developers/api/v1/flights/search", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": process.env.LETSFG_API_KEY!,
  },
  body: JSON.stringify({
    origin: "LHR",
    destination: "JFK",
    date_from: "2026-07-15",
    adults: 1,
    currency: "USD",
    limit: 25,
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const result = await response.json();
console.log(result.total_results, result.passenger_ids);
```

## Example response

```json
{
  "passenger_ids": ["pas_0"],
  "total_results": 18,
  "offers": [
    {
      "id": "off_abc123",
      "price": 612.4,
      "currency": "USD",
      "owner_airline": "Airline Name",
      "route": "LHR -> JFK"
    }
  ]
}
```

## What to persist from results

- `passenger_ids` for any later passenger mapping or booking continuation
- `offers[].id` for the option the user chooses
- `total_results` for analytics and QA
- the request body you used, so reruns and debugging stay reproducible

## Coverage and response time

The developer API uses the same 180+ airline connector fleet as the [letsfg.co](https://letsfg.co) consumer search. The fleet includes direct airline scrapers, OTA aggregators (Kiwi, Kayak, Momondo, Skyscanner), and virtual interlining — worldwide coverage including all US domestic routes.

| Route type | Typical response time |
|------------|-----------------------|
| Europe intra-continental | 20–40 seconds |
| Transatlantic | 30–60 seconds |
| US domestic | 60–90 seconds |
| Asia-Pacific / Latin America | 40–80 seconds |

Response times reflect how long the relevant connectors take to return results. The API returns as soon as a useful set of offers is available — set your client timeout to at least **90 seconds** to handle the full range.

Results are cached for 5 minutes. A second search for the same route and date returns immediately.

## Inspect provider visibility

```bash
curl https://letsfg.co/developers/api/v1/flights/providers \
  -H "X-API-Key: trav_your_api_key"
```

Use this endpoint when you want to understand which provider families are visible to the current public API environment.

## Zero results

A `200 OK` response with `total_results: 0` means the search ran successfully but no flights were found. Common reasons:

- **Date in the past** — `date_from` must be today or later.
- **Very near-term date** — same-day or next-day departures may not yet have inventory.
- **Niche or unserved route** — some city pairs have no direct or connecting service.
- **Cabin class filter** — `cabin_class: "F"` (first class) eliminates most LCCs; try `"M"` (economy) first.

If a route returns results on [letsfg.co](https://letsfg.co) but not via the API, check that your `date_from` is in the future and your client timeout is at least 90 seconds. The same connector fleet is used for both; a second request will usually return cached results immediately.

## Recommended production flow

1. Resolve city names to IATA codes with `/flights/locations/{query}`.
2. Confirm `agents/me` shows payment ready, API access enabled, and positive balance.
3. Send `POST /flights/search` with a reproducible request body.
4. Store `passenger_ids`, the chosen `offer.id`, and the original request metadata.
5. Handle 401, 402, 403, 409, and 429 explicitly rather than showing a generic failure.

Next: use [Errors and Limits](api-errors.md) to wire the failure states correctly.