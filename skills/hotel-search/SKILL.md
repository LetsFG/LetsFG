---
name: hotel-search
description: >-
  Search and book real hotel rooms through LetsFG. Returns bookable rates from live supplier
  inventory, refundable and non-refundable, with the price the guest actually pays. Use when
  the user asks to "find a hotel", "book a hotel", "find a room", "where should I stay in X",
  "hotels near Y", "cancel my hotel", or any accommodation query.
  Do NOT use for flights (use the flight-search skill), car rentals, or activities.
metadata:
  author: LetsFG - github.com/LetsFG
  version: '1.1.0'
---

# Hotel Search and Booking

Real, bookable hotel inventory through LetsFG. Booking works like a flight: the full price is
**held** on the connected card and charged only once the hotel confirms.

## Read this before your first call

**The same card authorises flights and hotels.** The PFS Bearer token (card-backed, from
connecting the MCP server — the consent step saves a card at <https://letsfg.co/connect>) is
accepted by the hotel endpoints, and so is a **Developer API key** (`X-API-Key`). Use whichever
you already hold. If you hold neither, do not register a billing account on someone's behalf
and do not fall back to scraping a hotel site — say so plainly to whoever asked.

**A card on file is required for search, not just booking.** A hotel search opens a real
session at the supplier and booking blocks a real rate, so every hotel endpoint returns
`402` without a payment method. This is deliberate: better to refuse up front than to let you
reach the point of commitment and discover you cannot pay.

**Every rate type is sold, refundable and non-refundable.** Each offer carries `refundable`
and, when it is refundable, `free_cancellation_until`. A non-refundable rate cannot be
cancelled for a refund once it is confirmed. Tell the guest which one they are booking before
you book — non-refundable rates are usually the cheapest, and that is the trade.

## How the money works

| Step | What happens | Charged |
|------|--------------|---------|
| Search | Nothing is held | Nothing |
| Book | The full `price` is **held** on the connected card, not taken. LetsFG books the room and pays the supplier itself | Nothing yet |
| Hotel confirms | The hold is captured | The `price` |
| Booking fails | The hold is released | Nothing |

There is no reservation fee, no deposit and no pay link: once a booking succeeds the guest owes
the hotel nothing further. (The 5% fee and supplier pay link belonged to the process retired on
2026-09-11; a booking made before that date keeps its original terms.)

`price` is the all-in total in the `currency` you searched in — USD unless you ask for another.
It is the supplier's cost plus 6.4% (our margin and payment processing) for Revolut Pay or a
card issued in the EEA, and 8.3% for a card issued elsewhere; `markup_rate` says which. Nothing
is added at booking.

## Workflow

```python
from letsfg import LetsFG
lfg = LetsFG(api_key="letsfg_...")      # the SDK's hotel methods take a Developer API key

# 1. Resolve the place name to a supplier city id
city = lfg.hotel_destinations("Warsaw")[0]

# 2. Search
stays = lfg.search_hotels(
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12", adults=2,
)
hotel = stays["hotels"][0]
offer = hotel["offers"][0]
# offer: price, currency, fx_rate, expected_cost, refundable, free_cancellation_until,
#        cancellation_policy, combination_id_v2, session_id

# 3. Book — asynchronous. book_hotel() returns a job; this helper polls for you.
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
    guests=[{"title": "Mr", "first_name": "Jan", "last_name": "Kowalski"}],
    email="guest@example.com", phone="512345678",
)
if booking["status"] == "succeeded":
    print(booking["confirmation"], booking["total_price"], booking["currency"])

# 4. Cancel a refundable booking before free_cancellation_until — refunded in full
lfg.cancel_hotel(booking["confirmation"])
```

Over raw HTTP the same steps are `POST /api/v1/hotels/destinations`, `POST /api/v1/hotels/search`,
`POST /api/v1/hotels/book`, `GET /api/v1/hotels/booking/{booking_job_id}` and
`POST /api/v1/hotels/cancel`, with either credential.

MCP tools, in call order: `resolve_hotel_city` → `search_hotels` → `book_hotel` →
`get_hotel_booking` → `cancel_hotel_booking`.

## Critical rules

1. **Never book again while a booking job is running — poll it.** A retry with the same
   `idempotency_key` returns the existing job (`duplicate: true`) instead of booking twice; a
   new key is a new booking. If a call times out, poll the job.
2. **Booking is asynchronous.** `book_hotel` returns a `booking_job_id`, not a booking. Poll
   `get_hotel_booking` every ~20s until `status` is final:
   - `succeeded` — booked and paid: `confirmation`, `total_price` + `currency` (what the guest
     is charged), `refundable`, `free_cancellation_until`, `terms`.
   - `failed` — nothing was booked, the hold is released and nothing was charged. Read `error`.
   - `attention` — the result could not be confirmed automatically and a person at LetsFG is
     checking it with the supplier. The hold is kept and nothing is charged. **Do not book
     again** and stop polling; the guest is e-mailed the outcome.
3. **Send `expected_price`, `expected_cost`, `currency` and `fx_rate` back verbatim** from the
   chosen offer. The booking is refused (`400 price_mismatch`) if they don't match or the
   supplier's price has moved, so a guest is never charged a price they did not agree to.
   There is no `expected_balance`.
4. **Use the guest's real email.** The confirmation goes there, and so does a message if the
   booking fails or needs checking. Names, phone and e-mail are validated before anything is held.
5. **Tell the guest whether the rate is refundable** before you book.
6. **A cancellation timeout is not a failure.** It drives a browser at the supplier and takes
   over a minute. Re-check before retrying.

## Error handling

| Status | Meaning | What to do |
|--------|---------|------------|
| `400 invalid_details` | A guest name, phone or e-mail was rejected (`invalid_fields` says which). Nothing held | Fix the details and call again |
| `400 price_mismatch` | Prices not copied verbatim from the offer | Send the offer's `price`, `expected_cost`, `currency` and `fx_rate` |
| `401` | Credential invalid, expired or revoked | Reconnect at https://letsfg.co/connect, or check the API key |
| `402` | No payment method connected, or the card declined the hold | Connect a card (required for search too). On a decline nothing was booked |
| `409` on cancel | The cancellation would cost money (non-refundable, or past `free_cancellation_until`) | Check the booking's `terms` |
| `504` | Supplier did not answer in time | If booking, poll the job — do NOT re-book |
| job `failed` | Rate gone, price moved, or the supplier declined | Read `error`; the hold was released. Search again |
| job `attention` | A person is confirming the outcome with the supplier | Do not re-book; the hold is kept, nothing charged |

## Links

- Hotels guide: <https://letsfg.co/developers/docs/hotels/>
- Agent guide: <https://letsfg.co/for-agents>
- Repo: <https://github.com/LetsFG/LetsFG>
