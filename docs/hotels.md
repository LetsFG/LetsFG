# Hotels

Hotels are live. Your agent can search real bookable inventory, book a room, and
hand the guest a pay link — with the same Developer API key it uses for flights.

!!! warning "Hotels need an X-API-Key, not the PFS Bearer token"
    The Bearer token used for programmatic flight search is rejected by every
    hotel endpoint. If you only hold a Bearer token you cannot book a hotel yet.
    This asymmetry is being closed; today it is simply how it works.

## How you pay

**10% now, the balance to the hotel later.**

At booking we charge 10% of the price to your card as a **non-refundable**
reservation fee. The rest is paid **directly to the supplier** through a
`pay_link` we return — we never hold it.

`balance_due_by` is the supplier's own auto-cancellation date, not a date we
invent. Miss it and the room is released.

## Two things that surprise people

**A card on file is required for search, not just booking.** A hotel search opens
a real session at the supplier and booking blocks a real rate, so we refuse up
front rather than let you reach the point of commitment and discover you cannot
pay. Every hotel endpoint returns `402` without a payment method.

**Only free-cancellation, pay-later rates are sold.** Those are the rates where
the balance can safely be settled with the supplier after booking, which is what
makes 10%-now/rest-later work. You will see fewer results than a metasearch.
Every one of them can actually be booked.

## Booking is asynchronous

`POST /hotels/book` returns a `booking_job_id`, **not** a booking. A real booking
takes minutes: the rate is re-blocked, the card charged, the room committed.
Poll `GET /hotels/booking/{booking_job_id}` every ~20s until `status` is
`succeeded` or `failed`.

This is not ceremony. It is what makes it impossible to charge a card and then
lose the confirmation to a timeout.

!!! danger "Do not retry a booking blindly"
    Calling `/hotels/book` twice for the same rate books the room twice and
    charges two reservation fees. If a call times out, poll the job — do not
    re-book.

The fee is charged **before** the room is committed, so a declined card costs
nothing: no reservation exists and nothing is charged.

## Flow

```bash
# 1. Resolve the city — take `Id` and `Name` from the first result
curl -X POST https://letsfg.co/developers/api/v1/hotels/destinations   -H "X-API-Key: $LETSFG_API_KEY" -H 'Content-Type: application/json'   -d '{"text": "Warsaw"}'

# 2. Search
curl -X POST https://letsfg.co/developers/api/v1/hotels/search   -H "X-API-Key: $LETSFG_API_KEY" -H 'Content-Type: application/json'   -d '{"city_id": 148614, "city_name": "Warsaw, Poland",
       "check_in": "2026-11-10", "check_out": "2026-11-12", "adults": 2}'

# 3. Book — returns a booking_job_id
# 4. GET /hotels/booking/{booking_job_id} until it settles
# 5. POST /hotels/cancel {"confirmation": "..."} to release it
```

Each offer carries `price` (what the guest pays), `reservation_fee_now`,
`balance_to_supplier` and `balance_due_by`. There is no wholesale figure in the
response to quote by mistake.

Send `expected_price` and `expected_balance` back to `/hotels/book` exactly as
search returned them. The booking is refused if the supplier's price has moved,
so a guest is never charged a price they did not agree to.

## Python

```python
from letsfg import LetsFG
lfg = LetsFG()

city = lfg.hotel_destinations("Warsaw")[0]
stays = lfg.search_hotels(
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12", adults=2,
)
hotel, offer = stays["hotels"][0], stays["hotels"][0]["offers"][0]

booking = lfg.book_hotel_and_wait(
    session_id=stays["session_id"],
    hotel_code=hotel["hotel_code"],
    combination_id_v2=offer["combination_id_v2"],
    expected_price=offer["price"],
    expected_balance=offer["balance_to_supplier"],
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12",
    guests=[{"title": "Mr", "first_name": "Jan", "last_name": "Kowalski"}],
    email="guest@example.com", phone="512345678",
)
print(booking["confirmation"], booking["pay_link"])
```

## Cancelling

`POST /hotels/cancel` with the `confirmation`. Free until `balance_due_by`;
after that the hotel's own ladder applies and can reach 100%. That ladder ships
in the booking's `terms`, so you can always see the cost first. **The 10%
reservation fee is not refunded.**

Cancellation drives a browser at the supplier and takes over a minute. If it
times out, do not assume it failed — re-check before retrying.

## MCP tools

`resolve_hotel_city` → `search_hotels` → `book_hotel` → `get_hotel_booking` →
`cancel_hotel_booking`.
