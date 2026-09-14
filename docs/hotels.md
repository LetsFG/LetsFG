# Hotels

Hotels are live. Your agent can search real bookable inventory — every rate type,
refundable and non-refundable — and book a room with the same Developer API key it
uses for flights.

!!! note "One credential covers flights and hotels"
    The same token you use for programmatic flight search reaches every hotel
    endpoint too — a Developer API key also works. Hotels do require a payment
    method on file for search as well as booking, which the connect step at
    <https://letsfg.co/connect> already saves.

## How you pay

**Exactly like a flight: held, then captured when the hotel confirms.**

At booking the full `price` is **held** on the connected Revolut method — not
taken. LetsFG pays the supplier with its own card, and the hold is captured only
once the hotel has confirmed the reservation. If the booking fails for any reason
(the rate is gone, the price moved, the supplier declined) the hold is released
and nothing is charged.

`price` is the all-in total. Nothing is added at checkout for your guest — unlike
a typical ~3% OTA booking fee.

## Two things that surprise people

**A payment method on file is required for search, not just booking.** A hotel
search opens a real session at the supplier and booking blocks a real rate, so we
refuse up front rather than let you reach the point of commitment and discover
you cannot pay. Every hotel endpoint returns `402` without a payment method.

**Non-refundable rates are sold, and they mean it.** Every offer carries
`refundable` and, when it is refundable, `free_cancellation_until`. A
non-refundable rate cannot be cancelled for a refund once it is confirmed. Show
those two fields to the guest before booking — they are usually the cheapest
rates on the list, and that is the trade.

## Booking is asynchronous

`POST /hotels/book` returns a `booking_job_id`, **not** a booking. A real booking
takes minutes: the rate is re-blocked, the room committed, the supplier paid.
Poll `GET /hotels/booking/{booking_job_id}` every ~20s until `status` is final:

| `status` | What it means |
|----------|---------------|
| `in_progress` | Still booking — keep polling |
| `succeeded` | Booked and paid. Carries `confirmation`, `total_price` + `currency` (what the guest is charged), `refundable`, `free_cancellation_until` and `terms` |
| `failed` | Nothing was booked. The hold is released and nothing was charged; `error` says why, written for the guest |
| `attention` | The outcome could not be confirmed automatically, so a person at LetsFG is checking it with the supplier. The hold is kept and nothing is charged. **Do not book again**, and stop polling |

This is not ceremony. It is what makes it impossible to hold a card and then
lose the confirmation to a timeout.

!!! danger "Poll, don't re-book"
    Never call `/hotels/book` again while its job is running — poll the job. A
    retry with the same `idempotency_key` returns the existing job
    (`duplicate: true`) instead of booking twice; a new key is a new booking.

The hold is captured only against a confirmed reservation, so a declined method
or a failed booking costs the guest nothing.

## Flow

```bash
# 1. Resolve the city — take `Id` and `Name` from the first result
curl -X POST https://letsfg.co/developers/api/v1/hotels/destinations   -H "X-API-Key: $LETSFG_API_KEY" -H 'Content-Type: application/json'   -d '{"text": "Warsaw"}'

# 2. Search
curl -X POST https://letsfg.co/developers/api/v1/hotels/search   -H "X-API-Key: $LETSFG_API_KEY" -H 'Content-Type: application/json'   -d '{"city_id": 148614, "city_name": "Warsaw, Poland",
       "check_in": "2026-11-10", "check_out": "2026-11-12", "adults": 2,
       "currency": "USD"}'

# 3. Book — returns a booking_job_id
# 4. GET /hotels/booking/{booking_job_id} until it settles
# 5. POST /hotels/cancel {"confirmation": "..."} to release a refundable booking
```

Prices are quoted in the `currency` you ask for — **USD unless you say
otherwise** (`"currency": "EUR"`, `"GBP"`, `"PLN"`, ...). The supplier itself
prices in PLN; the response says so in `supplier_currency`, and every offer
carries the `fx_rate` it was converted at, so the number you show a guest is
the number they are charged.

`price` is the supplier's cost plus 6.4% — our margin and the payment processing
fee — for Revolut Pay or a card issued in the EEA; an account whose connected
card was issued elsewhere is quoted at 8.3%. The response says which in
`markup_rate`. Nothing is added at booking.

Each offer carries `price` (what the guest pays, in `currency`), `refundable`,
`free_cancellation_until`, `cancellation_policy`, `session_id` and
`expected_cost` (the supplier's own figure, in the supplier's currency).
`expected_cost` exists only so it can be sent back verbatim — never quote it to
a guest.

Send `expected_price`, `expected_cost`, `currency` and `fx_rate` back to
`/hotels/book` exactly as the chosen offer returned them, with that offer's
`session_id`. The hold is placed in that currency. `currency` defaults to PLN on
this endpoint, so a USD offer sent without it is refused as `price_mismatch` —
and so is a booking whose supplier price has moved, so a guest is never charged
a price they did not agree to.

Guest names, phone and e-mail are checked before anything is held; a problem
answers `400 invalid_details` naming the fields.

**One name per guest.** `guests` lists every person in the room, children
included: adults first, then children in `child_ages` order (`Mr`/`Ms` is fine
for a child). The hotel needs a name for each one, so a booking with fewer names
than the party it was searched for fails before anything is submitted, and the
hold is released. The party itself travels with the offer's `session_id`.

```json
// search: 2 adults + a 7-year-old
{"city_id": 148614, "city_name": "Warsaw, Poland", "check_in": "2026-11-10",
 "check_out": "2026-11-12", "adults": 2, "children": 1, "child_ages": [7]}

// book: three names, the child last
"adults": 2,
"guests": [{"title": "Mr", "first_name": "Jan",   "last_name": "Kowalski"},
           {"title": "Ms", "first_name": "Anna",  "last_name": "Kowalska"},
           {"title": "Ms", "first_name": "Zofia", "last_name": "Kowalska"}]
```

Hotel search is look-to-book: 1,000 searches are free after every hotel booking,
then blocks of 1,000 for $5.00 from prepaid balance.

## Python

```python
from letsfg import LetsFG
lfg = LetsFG()  # reads LETSFG_API_KEY — the SDK's hotel methods take a Developer API key

city = lfg.hotel_destinations("Warsaw")[0]
stays = lfg.search_hotels(
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12", adults=2,
)
hotel, offer = stays["hotels"][0], stays["hotels"][0]["offers"][0]

booking = lfg.book_hotel_and_wait(
    session_id=offer["session_id"],
    hotel_code=hotel["hotel_code"],
    combination_id_v2=offer["combination_id_v2"],
    expected_price=offer["price"],
    expected_cost=offer["expected_cost"],
    currency=offer["currency"],
    fx_rate=offer["fx_rate"],
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12",
    guests=[{"title": "Mr", "first_name": "Jan", "last_name": "Kowalski"},     # one entry per guest:
            {"title": "Ms", "first_name": "Anna", "last_name": "Kowalska"}],   # adults=2 -> two names
    email="guest@example.com", phone="512345678",
)
if booking["status"] == "succeeded":
    print(booking["confirmation"], booking["total_price"], booking["currency"])
```

On success the booking carries `confirmation`, `total_price`, `currency`,
`refundable`, `free_cancellation_until` and `terms` (with the hotel's full
cancellation ladder), plus `supplier_paid` / `supplier_currency` — what LetsFG
paid the supplier, for your records.

## What the guest is told

The guest's `email` hears from LetsFG however the booking ends:

- **succeeded** — a confirmation with the supplier's confirmation code, the
  cancellation term and the total paid;
- **failed** — the booking did not go through, the hold has been released and
  nothing was charged;
- **attention** — we are confirming it with the supplier, nothing has been
  charged, and it should not be booked again; the guest is e-mailed the outcome.

## Cancelling

`POST /hotels/cancel` with the `confirmation` of a booking your account made
(anything else is `404`). Only a `refundable` booking, and only until its
`free_cancellation_until` — the charge is then refunded in full to the payment
method. After that date, or on a non-refundable rate, the hotel's own
ladder applies and can reach 100%; that ladder ships in the booking's `terms`, so
you can always see the cost first, and the endpoint refuses rather than
forfeiting money on the guest's behalf.

Cancellation drives a browser at the supplier and takes over a minute. If it
times out, do not assume it failed — re-check before retrying.

## MCP tools

`resolve_hotel_city` → `search_hotels` → `book_hotel` → `get_hotel_booking` →
`cancel_hotel_booking`. `get_hotel_booking` reports the same `succeeded` /
`failed` / `attention` statuses as the API.

## Bookings made before 2026-09-11

Until 2026-09-11 hotels used a different, now retired process: a 5%
non-refundable reservation fee at booking, and the balance paid to the supplier
through a pay link by a deadline. Bookings made then keep their original terms,
and their pay link is re-issued through the letsfg.co website (My Trips), not the
API. Nothing booked since then works that way.
