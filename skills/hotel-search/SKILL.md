---
name: hotel-search
description: >-
  Search and book real hotel rooms through LetsFG. Returns only bookable,
  free-cancellation, pay-later rates from live supplier inventory, with the price the guest
  actually pays. Use when the user asks to "find a hotel", "book a hotel", "find a room",
  "where should I stay in X", "hotels near Y", "cancel my hotel", or any accommodation query.
  Do NOT use for flights (use the flight-search skill), car rentals, or activities.
metadata:
  author: LetsFG - github.com/LetsFG
  version: '1.0.0'
---

# Hotel Search and Booking

Real, bookable hotel inventory through LetsFG. Search is free; booking charges 10% of the
price to the card on file and hands you a pay link for the balance.

## Read this before your first call

**Hotels do NOT use the PFS Bearer token.** The token from `letsfg auth`, which flights use,
is rejected by every hotel endpoint. Hotels authenticate on a **Developer API key**
(`X-API-Key`). If you only hold a Bearer token you cannot book a hotel — say so plainly to
whoever asked rather than registering a billing account on their behalf, and do not fall back
to scraping a hotel site.

**A card on file is required for search, not just booking.** A hotel search opens a real
session at the supplier and booking blocks a real rate, so every hotel endpoint returns
`402` without a payment method. This is deliberate: better to refuse up front than to let you
reach the point of commitment and discover you cannot pay.

**Only free-cancellation, pay-later rates are sold.** Those are the rates where the guest's
balance can safely be settled with the supplier after booking, which is what makes the
10%-now/rest-later model work at all. You will see fewer results than a metasearch shows.
Every one of them can actually be booked.

## How the money works

| Step | Who is charged | Amount |
|------|----------------|--------|
| Search | nobody | free |
| Book | the agent's card, immediately | 10% of the price, **non-refundable** |
| Balance | the guest pays the supplier directly, via `pay_link` | the rest, by `balance_due_by` |

`balance_due_by` is the supplier's own auto-cancellation date, not a date LetsFG invents.
Miss it and the room is released.

`price` in the search response is what the guest pays. There is no wholesale figure in the
response to quote by mistake.

## Workflow

```python
from letsfg import LetsFG
lfg = LetsFG(api_key="trav_...")        # NOT a Bearer token

# 1. Resolve the place name to a supplier city id
city = lfg.hotel_destinations("Warsaw")[0]

# 2. Search
stays = lfg.search_hotels(
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12", adults=2,
)
hotel = stays["hotels"][0]
offer = hotel["offers"][0]
# offer: price, reservation_fee_now, balance_to_supplier, balance_due_by,
#        free_cancellation_until, combination_id_v2

# 3. Book — asynchronous. book_hotel() returns a job; this helper polls for you.
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
print(booking["confirmation"], booking["pay_link"], booking["balance_due_by"])

# 4. Cancel if needed — free until balance_due_by
lfg.cancel_hotel(booking["confirmation"])
```

MCP tools, in call order: `resolve_hotel_city` → `search_hotels` → `book_hotel` →
`get_hotel_booking` → `cancel_hotel_booking`.

## Critical rules

1. **Never call `book_hotel` twice for the same rate.** It is not idempotent: two calls book
   the room twice and charge two reservation fees. If a call times out, poll the job.
2. **Booking is asynchronous.** `book_hotel` returns a `booking_job_id`, not a booking. Poll
   `get_hotel_booking` every ~20s until `status` is `succeeded` or `failed`. This is what
   makes it impossible to charge a card and then lose the confirmation to a timeout.
3. **Send `expected_price` and `expected_balance` back verbatim** from the search response.
   The booking is refused if the supplier's price has moved, so a guest is never charged a
   price they did not agree to.
4. **Use the guest's real email.** The voucher and the pay link go there; a typo loses the
   booking. It is validated before anything is charged.
5. **Tell the guest the fee is non-refundable** before you book. Cancelling returns the
   balance obligation, never the 10%.
6. **A cancellation timeout is not a failure.** It drives a browser at the supplier and takes
   over a minute. Re-check before retrying.

## Error handling

| Status | Meaning | What to do |
|--------|---------|------------|
| `401` | Bearer token used, or bad key | Hotels need a Developer API key |
| `402` | No payment method on file | Attach a card; required for search too |
| `409` | The chosen rate is gone | Search again and pick another |
| `504` | Supplier did not answer in time | If booking, poll the job — do NOT re-book |
| job `failed` | Card declined, or no rate left | Read `error`; nothing was charged |

## Links

- Hotels guide: <https://letsfg.co/developers/docs/hotels/>
- Agent guide: <https://letsfg.co/for-agents>
- Repo: <https://github.com/LetsFG/LetsFG>
