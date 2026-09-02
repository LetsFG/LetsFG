# LetsFG API Reference

> **MPP:** a card-free *enrolment* lane for agents holding a Tempo wallet is
> offered only when the `402` from `POST /api/agent-access/request` carries an
> `mpp` object. It costs **$0.01 once**, as verification only. Search stays free
> and booking costs the price on the offer. Earlier revisions of this page
> described an MPP charge at *unlock* time; that never shipped. See
> <https://letsfg.co/for-agents>.

> ### ⚠️ Agents: do not create a Developer API account
>
> Do **NOT** call `/developers/api/v1/agents/register` or
> `/developers/api/v1/agents/setup-payment`, and do **NOT** run
> `letsfg register` or `letsfg setup-payment`. Those belong to a separate,
> paid, prepaid-balance product for high-volume commercial integrations and
> create a billing account you almost certainly do not want.
>
> To search and book flights, connect LetsFG as an MCP server at
> `https://letsfg.co/developers/api/mcp` and approve it — the consent step saves
> a card at <https://letsfg.co/connect> (nothing charged). Then search and book.
> See <https://letsfg.co/for-agents>.

Full endpoint details for the LetsFG flight search and booking API.

**Base URL:** `https://letsfg.co/developers/api/v1`

## Authentication

All endpoints (except `register`) require the `X-API-Key` header:

```
X-API-Key: trav_your_api_key
```

## Endpoints

### Register Agent

```
POST /api/v1/agents/register
```

No auth required.

```json
{
  "agent_name": "my-agent",
  "email": "agent@example.com"
}
```

**Response:**

```json
{
  "agent_id": "ag_xxx",
  "api_key": "trav_xxxxx..."
}
```

### Setup Payment

```
POST /api/v1/agents/setup-payment
```

```json
{
  "token": "<card token>"
}
```

Required before the first Developer API booking. Card stays on file. Agents on
the PFS lane do not use this — their card is saved at <https://letsfg.co/connect>
when they connect the MCP server.

### Agent Profile

```
GET /api/v1/agents/me
```

Returns agent details, search count, booking count, payment status.

### Resolve Location

```
GET /api/v1/flights/locations/{query}
```

Example: `GET /api/v1/flights/locations/London`

**Response:**

```json
[
  {"iata_code": "LON", "name": "London", "type": "city"},
  {"iata_code": "LHR", "name": "Heathrow", "type": "airport", "city": "London"},
  {"iata_code": "LGW", "name": "Gatwick", "type": "airport", "city": "London"}
]
```

### Search Flights

```
POST /api/v1/flights/search
```

```json
{
  "origin": "LHR",
  "destination": "JFK",
  "date_from": "2026-04-15",
  "adults": 1,
  "children": 0,
  "infants": 0,
  "cabin_class": "M",
  "max_stopovers": 2,
  "currency": "EUR",
  "sort": "price",
  "limit": 20
}
```

**Optional fields:** `date_to`, `return_from`, `return_to` (for round-trip), `cabin_class` (M/W/C/F).

**Response:**

```json
{
  "search_id": "sea_xxx",
  "passenger_ids": ["pas_0"],
  "total_results": 47,
  "offers": [
    {
      "id": "off_xxx",
      "price": 189.50,
      "currency": "EUR",
      "airlines": ["British Airways"],
      "owner_airline": "British Airways",
      "outbound": {
        "segments": [
          {
            "airline": "British Airways",
            "flight_no": "BA178",
            "origin": "LHR",
            "destination": "JFK",
            "departure": "2026-04-15T09:00:00",
            "arrival": "2026-04-15T12:15:00",
            "duration_seconds": 27900
          }
        ],
        "route_str": "LHR → JFK",
        "total_duration_seconds": 27900,
        "stopovers": 0
      },
      "conditions": {
        "refund_before_departure": "allowed_with_fee",
        "change_before_departure": "allowed_with_fee"
      }
    }
  ]
}
```

### Unlock Offer

```
POST /api/v1/bookings/unlock
```

```json
{
  "offer_id": "off_xxx"
}
```

**Response:**

```json
{
  "offer_id": "off_xxx",
  "confirmed_price": 189.50,
  "confirmed_currency": "EUR",
  "offer_expires_at": "2026-04-15T15:30:00Z"
}
```

**Errors:**
- 402 — Payment required: no card on file (attach via setup-payment)
- 410 — Offer expired (search again)

### Book Flight

```
POST /api/v1/bookings/book
```

```json
{
  "offer_id": "off_xxx",
  "passengers": [
    {
      "id": "pas_0",
      "given_name": "John",
      "family_name": "Doe",
      "born_on": "1990-01-15",
      "gender": "m",
      "title": "mr",
      "email": "john@example.com",
      "phone_number": "+1234567890"
    }
  ],
  "contact_email": "john@example.com",
  "idempotency_key": "unique-key-123"
}
```

**Response:**

```json
{
  "booking_reference": "ABC123",
  "status": "confirmed",
  "flight_price": 189.50,
  "currency": "EUR"
}
```

**Errors:**
- 402 — Payment declined
- 403 — Offer not unlocked first
- 409 — Fare changed (re-unlock) or already booked (idempotency)
- 410 — 30-minute window expired (search + unlock again)

## PFS lane (agents) — search, book, poll on letsfg.co

The endpoints above are the paid Developer API. Agents use the PFS lane on
`https://letsfg.co` with a card-backed Bearer token (see `mcp-setup.md`):

```
POST /api/search              {"origin":"LHR","destination":"BCN","date_from":"2026-06-15"}  → {"search_id":"ws_...","status":"searching"}
GET  /api/results/{search_id}  poll every 10 s → {"status":"completed","offers":[...]}
POST /api/agent-book          {"search_id","offer_id","contact_email","passenger":{...}}
POST /api/agent-book/status   {"booking_ref":"eyJ..."}   poll every 20–30 s
```

`POST /api/agent-book` holds the fare plus LetsFG's markup on the connected card
(not taken), dispatches a LetsFG booking agent, and returns within seconds:

```json
{"ok": true, "booked": false, "state": "booking_in_progress",
 "booking_id": "agt_1788...", "booking_ref": "eyJ...",
 "held": {"amount": 93, "currency": "EUR", "card": "visa ending 5709"}, "charged": 0}
```

`passenger` (one per call): given_name, family_name, born_on, gender (m/f),
nationality (ISO-2), phone_number + phone_country, address_line1, address_city,
address_postal, address_country; passport_number / passport_country /
passport_expiry optional. Missing anything →
`{"error":"missing_details","missing_fields":[...],"charged":0}`. No card →
`payment_method_required`, card refused → `payment_declined`, both with
`add_card_url: https://letsfg.co/connect` and `charged: 0`.

Status walks `booking_in_progress` → `completed` (`pnr`, `charged_amount`,
`currency`) | `failed` (`failure_reason`; hold released, nothing charged) |
`needs_attention` (a human at LetsFG is checking it — do NOT book again). The
booking takes 4–11 minutes; only `completed` with a PNR means booked. Never
start a second booking for the same trip while one is in progress.

## Error Codes

| Error Code | Category | HTTP | Description |
|------------|----------|------|-------------|
| `SUPPLIER_TIMEOUT` | transient | 504 | Airline API didn't respond — retry |
| `RATE_LIMITED` | transient | 429 | Too many requests — wait and retry |
| `INVALID_IATA` | validation | 422 | Bad airport/city code — use resolve_location |
| `INVALID_DATE` | validation | 422 | Date in wrong format or in the past |
| `OFFER_EXPIRED` | business | 410 | Offer no longer available — search again |
| `PAYMENT_REQUIRED` | business | 402 | No card on file — Developer API: attach via setup-payment; PFS: `add_card_url` → https://letsfg.co/connect |
| `FARE_CHANGED` | business | 409 | Price changed — re-unlock |
| `ALREADY_BOOKED` | business | 409 | Duplicate (idempotency_key matched) |

## Discovery

| Endpoint | URL |
|----------|-----|
| OpenAPI/Swagger | https://letsfg.co/developers/api/docs |
| Agent discovery | https://letsfg.co/developers/api/.well-known/ai-plugin.json |
| Agent manifest | https://letsfg.co/developers/api/.well-known/agent.json |
| LLM instructions | https://letsfg.co/developers/api/llms.txt |
| MCP (Streamable HTTP) | https://letsfg.co/developers/api/mcp |
