# Sandbox Environment

> ### ⚠️ Agents: do not create a Developer API account
>
> Do **NOT** call `/developers/api/v1/agents/register` or
> `/developers/api/v1/agents/connect-payment`, and do **NOT** run
> `letsfg register` or `letsfg connect-payment`. Those belong to a separate,
> paid, prepaid-balance product for high-volume commercial integrations and
> create a billing account you almost certainly do not want.
>
> To search and book flights, connect LetsFG as an MCP server at
> <https://letsfg.co/developers/api/mcp>. Approving it opens
> <https://letsfg.co/connect>: one tap, no card. A card is asked for at the first booking.
> See <https://letsfg.co/for-agents>.

Test your integration without consuming prepaid balance or firing real connectors.
The sandbox mirrors the full Developer API surface — same endpoints, same request
schema, same response schema — but returns realistic fake data instantly.

## Base URL

```
https://letsfg.co/developers/api/v1/sandbox/
```

Add `sandbox/` between `v1/` and the endpoint name.

> ### The sandbox does not need a key — and there is only ever one key
>
> The sandbox is open: you can call it with **no API key at all**, so you can
> try LetsFG before adding a card. If you *do* send a key it must be a real,
> current one — an unknown key is rejected with exactly the 401 production
> returns, so a sandbox call can no longer pass while the same key fails live.
>
> There is **no separate sandbox key and no separate production key**, and
> nothing to activate to "switch on" production. It is one key, from
> <https://letsfg.co/developers>, for both. If production returns
> `401 This API key is not valid for any LetsFG account`, the key your code is
> sending is not the key on your account — almost always because it was
> rotated after your code was deployed. Rotating (and email recovery) issues a
> new key and kills the old one immediately. Copy the current value from the
> portal into your app.

| Real endpoint | Sandbox equivalent |
|---|---|
| `POST /v1/flights/search` | `POST /v1/sandbox/flights/search` |
| `POST /v1/flights/discover` | `POST /v1/sandbox/flights/discover` |
| `POST /v1/flights/multi-search` | `POST /v1/sandbox/flights/multi-search` |
| `POST /v1/flights/parse-query` | `POST /v1/sandbox/flights/parse-query` |
| `GET /v1/flights/locations/{q}` | `GET /v1/sandbox/flights/locations/{q}` |
| `POST /v1/flights/book` | `POST /v1/sandbox/flights/book` |
| `GET /v1/flights/bookings/{id}` | `GET /v1/sandbox/flights/bookings/{id}` |
| `POST /v1/flights/bookings/{id}/answer` | `POST /v1/sandbox/flights/bookings/{id}/answer` |
| `POST /v1/flights/bookings/{id}/stop` | `POST /v1/sandbox/flights/bookings/{id}/stop` |

Booking works in the sandbox too, and it behaves like a real booking: the same
responses, the same states, the same questions and roughly the same wait. See
[Booking in the sandbox](#booking-in-the-sandbox).

## Sandbox search example

```bash
curl -X POST https://letsfg.co/developers/api/v1/sandbox/flights/search \
  -H "X-API-Key: letsfg_your_api_key" \
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
| Connectors fired | Yes (hundreds) | No |
| Counts against your allowance | Yes (1 search) | No |
| Response time | 8–10 s to first results | < 1 s |
| `booking_url` | A letsfg.co page for that offer | Placeholder |
| `parse-query` NL accuracy | Full Gemini parse | Stub (returns missing fields) |
| `total_results` | Real count | Fake large number (~800–1 800) |
| `POST /flights/book` | Holds the fare on your connected card; an agent buys the ticket | Nothing is held and nothing is bought; the booking is simulated |
| Booking duration | 4–11 minutes | The same by default; `"speed": "fast"` runs it in about a minute |
| PNR | The airline's | A fake 6-character reference |

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
  -H "X-API-Key: letsfg_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "origin": "JFK",
    "destinations": ["LAX", "MIA", "ORD", "DFW", "SEA"],
    "date_from": "2026-07-15",
    "currency": "USD"
  }'
```

All destinations run in under a second. `charged_searches: 0` in the summary
confirms no allowance was used.

## Booking in the sandbox

A real booking takes minutes, can stop to ask you something, and can end in
several different ways. You need to build for all of that, and you should not
spend real money finding out what your code does when a price changes halfway
through. The sandbox booking lets you run the whole thing for free:

- **The same requests and responses.** The same request body as
  [`POST /flights/book`](api-booking.md), the same `202`, and the same poll
  fields. Refusals use the same `error` codes, flat JSON and `charged: 0`.
  Schema errors are the same `422`.
- **The same states, in real time.** `authorised` → `card_issued` →
  `booking_in_progress` → (`awaiting_settlement`) → `completed`, taking about
  as long as a real booking takes.
- **The same questions.** A seat map, a paid extra and a price change each
  pause the booking. You can answer each one, decline it, or let it expire, and
  the booking continues or ends exactly as it would in production.
- **The same checks on travellers.** Missing details, missing passports,
  impossible phone numbers, a passport that expires before the flight: each is
  refused with the same `missing_fields` / `invalid_fields` body production
  sends. They run the same code production runs, and a test keeps the two
  identical.
- **No money, no seller, no ticket.** The card is a fake Visa ending `4242`.
  Every sandbox response carries `"sandbox": true`.

### 1. Search, then book an offer from that search

Book an offer from a **sandbox** search, just as in production. A sandbox
search stays bookable for 6 hours.

```bash
curl -X POST https://letsfg.co/developers/api/v1/sandbox/flights/book \
  -H "Content-Type: application/json" \
  -d '{
    "search_id": "sb_WAW_BCN_3f9c1a7e21",
    "offer_id": "sb_WAW_BCN_0000_cf15b25f",
    "idempotency_key": "order-1042",
    "contact_email": "traveller@example.com",
    "want_seat": true,
    "passengers": [{
      "given_name": "Ada", "family_name": "Lovelace",
      "born_on": "1990-01-15", "gender": "f",
      "email": "traveller@example.com",
      "phone_number": "+48501234567", "phone_country": "PL",
      "nationality": "PL",
      "address_line1": "Szafera 1", "address_city": "Krakow",
      "address_postal": "31-543", "address_country": "PL",
      "passport_number": "EA1234567", "passport_country": "PL",
      "passport_expiry": "2031-05-01", "passport_issue": "2021-05-01"
    }],
    "sandbox": {"scenario": "price_change", "speed": "realistic"}
  }'
```

It answers `202` a few seconds later, just like production:

```json
{
  "ok": true,
  "booking_id": "sb_dev_1790359173123a1e5",
  "state": "authorised",
  "dispatched": true,
  "held": {"amount": 69, "currency": "EUR", "card": {"brand": "visa", "last4": "4242", "type": "card"}},
  "charged": 0,
  "offer": {"search_id": "sb_WAW_BCN_3f9c1a7e21", "offer_id": "sb_WAW_BCN_0000_cf15b25f", "seats": 1, ...},
  "poll_url": "https://letsfg.co/developers/api/v1/sandbox/flights/bookings/sb_dev_1790359173123a1e5",
  "message": "69 EUR is held (not taken) on the connected visa ending 4242. ...",
  "sandbox": true
}
```

`held.amount` is the price the search showed for that offer, for the whole
party. Lap infants do not take a seat. An offer priced in a currency cards
cannot be charged in (BRL, CNY, ...) is held in USD, with a `quoted` block
giving the original price. So what you show in the sandbox is what you will
show live.

The `sandbox` block is optional and only the sandbox reads it. Production
ignores it, so it does no harm if it is still in your request when you go
live.

### 2. Pick what happens: `sandbox.scenario`

| `scenario` | What the booking does |
|---|---|
| `success` (default) | Runs to `completed` with a PNR. `charged_amount` equals `held_amount`. |
| `price_change` | Pauses on a `price_change` question. **Accept** → `completed`, and `charged_amount` includes the rise. **Decline**, or let it expire → `failed`, hold released, `failure_reason` says why. |
| `extra` | Pauses on a paid `extra` (a checked bag). Accept, decline or let it expire; it then runs to `completed` either way. |
| `seller_failed` | The seller could not sell the ticket. As in production, the booking is **not** failed: it ends in `needs_attention` with `manual_booking: true` and the hold kept, because a person finishes it by hand. Show "we're still booking" and do not book again. |
| `needs_attention` | Ends in `needs_attention` with `manual_booking: false`: money moved and the outcome is unclear. Do not book again. |
| `payment_declined` | `POST /book` answers `402 payment_declined` with `decline_reason: "insufficient_funds"`. Polling the `booking_id` shows `failed`. Booking again with the **same** `idempotency_key` starts a fresh attempt, up to 5 attempts, then `409 too_many_attempts`. |
| `payment_method_required` | `POST /book` answers `402 payment_method_required`. |
| `temporarily_unavailable` | `POST /book` answers `503 temporarily_unavailable`. |

`"want_seat": true` works with any scenario. It adds a seat map question,
exactly as it does in production.

### 3. Pick how long it takes: `sandbox.speed`

| | `realistic` (default) | `fast` |
|---|---|---|
| `authorised` → `card_issued` | 3–8 s | under 1 s |
| → `booking_in_progress` | 1–3 min (the booking agent starting up) | 5–18 s |
| Agent at the seller | 2.5–5.5 min | 15–33 s |
| `awaiting_settlement` | Skipped about half the time; otherwise 1–4 min | 6–24 s |
| Seat map question open | typically 5 min | 60 s |
| Extra / price change question open | typically 15 min (5 min when `want_seat` is set) | 60 s |
| End to end, no questions | 3.5–12 min | 20–75 s |

Use `realistic` to check your UI and your timeouts. Use `fast` in CI. The
durations are fixed per booking, so polling the same `booking_id` walks the
same path every time.

### 4. Poll, and answer questions

Poll `GET /sandbox/flights/bookings/{id}` every 20–30 seconds. The response has
the same fields as production:

```json
{
  "booking_id": "sb_dev_1790359173123a1e5",
  "state": "booking_in_progress",
  "terminal": false,
  "pnr": "",
  "currency": "EUR",
  "held_amount": 69,
  "charged_amount": null,
  "card_last4": "4242",
  "failure_reason": "",
  "decline_reason": "",
  "manual_booking": false,
  "updated_at_ms": 1790359353197,
  "offer": {"search_id": "sb_WAW_BCN_3f9c1a7e21", "offer_id": "sb_WAW_BCN_0000_cf15b25f"},
  "question": {
    "kind": "price_change",
    "round": 1,
    "extra": {"label": "Fare price changed", "count": 1, "unit_price": 5.12, "total": 5.12,
              "currency": "EUR", ...},
    "seller": "Sandbox Air",
    "charge": {"amount": 5.35, "currency": "EUR"},
    "price_change": {"old_total": 69, "new_total": 74.35, "currency": "EUR"},
    "expires_at_ms": 1790360253197,
    "answer": "POST .../answer with {round, confirm:true} to accept or {round, skip:true} to decline"
  },
  "message": "The booking is PAUSED on a question that must be answered within its window, ...",
  "sandbox": true
}
```

- Show the traveller `question.charge` (or `question.price_change.new_total`
  for a price change). That is what their card will be charged, in their
  currency. `question.extra` is the seller's own figure in the seller's
  currency.
- A seat map lists every seat as `{d, row, col, state, price, ccy}`. Answer
  with `{"round": 1, "seats": [{"passenger": 0, "designator": "12C"}]}`. A
  `taken` seat, a seat that is not on the map, or one seat given to two
  travellers is refused with `409 answer_refused`, and the question stays
  open.
- Echo the `round`. A wrong round is `409 answer_refused`. Answering when
  nothing is open is `409 no_open_question`.
- Time a question out on its own `expires_at_ms`, not on a fixed number of
  minutes. Production sets each window per booking, and it can be shorter
  near the end of a run.
- `updated_at_ms` changes only when `state` changes. Use it to detect
  progress.
- **Keep polling while a question is open.** A booking treats your polls as
  "the traveller is still here". If nobody polls for 2 minutes while a seat
  map or a paid extra is open, the booking gives up on it and carries on
  without it, as production does. A price change always waits until it
  expires.

### 5. Stop a booking

`POST /sandbox/flights/bookings/{id}/stop` returns what production returns
for the state the booking is in:

| Booking is | `status` | Then |
|---|---|---|
| `authorised` / `card_issued` | `stopped` | `failed` immediately, hold released |
| `booking_in_progress` | `stopping` | `failed` within about a minute, with `failure_reason: "the customer stopped the booking before anything was paid"` |
| `awaiting_settlement` / `completed` | `too_late` | Nothing changes; the ticket is bought |
| `needs_attention` | `with_a_person` | The stop is recorded for the person handling it |
| `failed` | `already_ended` | Nothing |

### 6. Idempotency

Retrying `POST /book` with the same `idempotency_key` returns the booking that
key already opened, with `"duplicate": true`, and never opens a second one.
The sandbox does not need an API key, so keys are scoped to the caller: two
callers who happen to use the same key get separate bookings.

### Before you go live, make sure your integration handles

- [ ] `missing_fields` and `invalid_fields`: ask the traveller, then call again.
      A passport is required for **every** traveller.
- [ ] A `202`, then polling until `terminal` is true, without calling
      `/book` again in between.
- [ ] A `seat` question (`want_seat: true`): show the map, send a seat, or skip.
- [ ] A `price_change`: show the new total. Accept → `completed`.
      Decline → `failed`.
- [ ] An `extra`: accept or decline; the booking completes either way.
- [ ] `needs_attention` with `manual_booking: true`: tell the traveller you
      are still booking, and never book again.
- [ ] `payment_declined`: let them fix the card, then retry with the same
      `idempotency_key`.
- [ ] Stop at each stage.
- [ ] A network timeout on `/book`: retry with the same `idempotency_key` and
      get `duplicate: true`.

### What the sandbox does not do

- **No e-mails.** In production the traveller gets the airline's confirmation
  at `contact_email`. An unanswered price change is also e-mailed to them
  about 40 seconds after it opens.
- **Fixed exchange rates.** An offer priced in a currency cards cannot be
  charged in is converted at a fixed, illustrative rate. Production uses that
  day's rate.
- **No account behind the key.** A booking is found by its `booking_id` alone.
  In production, only the key that opened a booking can read it.
- **Some refusals never happen here.** These depend on your account, the
  traveller's history or a real seller, so the sandbox cannot produce them.
  Handle them from the [booking guide](api-booking.md#refusals):
  `not_your_search`, `cabin_not_proven`, `offer_not_bookable`,
  `package_blocked`.

## Typical integration workflow

1. Build and test your full integration against the sandbox — iterate freely, no cost.
2. Verify that your code correctly reads `offers`, `passenger_ids`, and `airlines_summary`.
3. Confirm your `departure_time_from`/`to` filter logic returns the expected subset.
4. Check your credentials against a **free production** endpoint before you switch —
   `GET /v1/agents/me` costs nothing and either returns your account or tells you
   the key is wrong. This is the one thing the sandbox cannot confirm for you if
   you were calling it anonymously.
5. Switch to production endpoints (drop `sandbox/` from the path) when ready.
6. Credits are only consumed by production searches.

```bash
# Step 4 — free, no allowance consumed, no card needed
curl https://letsfg.co/developers/api/v1/agents/me \
  -H "X-API-Key: letsfg_your_api_key"
```
