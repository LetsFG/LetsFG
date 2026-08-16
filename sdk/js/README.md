# LetsFG — Your AI agent just learned to book flights. (Node.js)

**Server-side search engine. Real prices. One function call.** Search hundreds of airlines at raw airline prices — **$20–$50 cheaper** than Booking.com, Kayak, and other OTAs. Zero dependencies. Built for AI agents.

[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![npm](https://img.shields.io/npm/v/letsfg)](https://www.npmjs.com/package/letsfg)

## Two ways to use LetsFG

| | **CLI / SDK** (this package) | **Developer API** |
|---|---|---|
| **Search cost** | Free (Bearer token via `letsfg auth` — zero-amount card setup) | Prepaid credits |
| **Booking** | `POST /api/agent-book` — confirmed order or a booking link, no LetsFG fee | Direct airline URL (unlock required first) |
| **Speed** | 60–90 s | 2–5 s (discover) · 60–90 s (full) |
| **Setup** | `npm install letsfg` then `letsfg auth` | [letsfg.co/developers](https://letsfg.co/developers) |

> **Want direct airline URLs without any per-booking fee?** Use the [Developer API](https://letsfg.co/developers) — prepaid credits, results in seconds, no checkout step.

## Install

```bash
npm install letsfg
```

## Quick Start (SDK)

```typescript
import { LetsFG, cheapestOffer, offerSummary } from 'letsfg';

// PFS — free. Get a Bearer token once with `letsfg auth` (zero-amount card
// setup, nothing charged), then pass it here.
const bt = new LetsFG({ bearerToken: 'eyJ...' });

// Search — FREE
const flights = await bt.search('GDN', 'BER', '2026-03-03');
const best = cheapestOffer(flights);
console.log(offerSummary(best));

// Book — free, ticket price only, no LetsFG fee. No unlock step.
const result = await bt.book(
  best.id,
  [{ given_name: 'John', family_name: 'Doe', born_on: '1990-01-15', gender: 'm' }],
  'john@example.com',
  '',
  '',
  flights.search_id,
);
if (result.booked) {
  console.log(`Order: ${result.order_id}`);
} else {
  console.log(`Booking link (nothing charged): ${result.booking_url}`);
}
```

Prefer the paid Developer API instead? Pass `apiKey` instead of `bearerToken` —
`search()`/`book()` dispatch automatically. That path requires `unlock()`
(1% fee, min $3) before `book()`.

## Quick Start (CLI)

```bash
export LETSFG_BEARER_TOKEN=<your-bearer-token>  # from `letsfg auth`

letsfg search GDN BER 2026-03-03 --sort price
letsfg search LON BCN 2026-04-01 --json  # Machine-readable
letsfg book off_xxx --search-id srch_xxx -p '{"given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m"}' -e john@example.com
```

## API

### `new LetsFG({ bearerToken?, apiKey?, baseUrl?, timeout? })`

### `bt.search(origin, destination, dateFrom, options?)`
### `bt.resolveLocation(query)`
### `bt.unlock(offerId)` — Developer API only
### `bt.book(offerId, passengers, contactEmail, contactPhone?, idempotencyKey?, searchId?)`
Dispatches on which credential is set: `bearerToken` → free PFS booking via
`POST /api/agent-book` (pass `searchId`, one passenger). `apiKey` → paid
Developer API `book` (requires `unlock()` first, supports multiple passengers
and `idempotencyKey`).
### `bt.setupPayment(token?)` — Developer API only
### `bt.me()`
### `LetsFG.register(agentName, email, baseUrl?, ownerName?, description?)` — Developer API only, most agents don't need this

### Helpers
- `offerSummary(offer)` — One-line string summary
- `cheapestOffer(result)` — Get cheapest offer from search

## Starlink Wi-Fi

Offers may carry `starlink`: `confirmed_all` / `confirmed_some` mean the carrier
has **fully** fitted that aircraft type; `likely_all` / `likely_some` mean the
rollout on that type is underway but incomplete. Segments carry `confirmed` or
`likely`.

Only `confirmed_*` is safe to state as fact — `likely_*` is a signal, not a
promise. Anything ending `_some` has at least one leg without it. An **absent**
field means no information, **not** an absence of Wi-Fi.

Full semantics: [docs/api-search.md](https://github.com/LetsFG/LetsFG/blob/main/docs/api-search.md#starlink-wi-fi).

## Zero Dependencies

Uses native `fetch` (Node 18+). No `axios`, no `node-fetch`, nothing. Safe for sandboxed environments.

## Also Available As

- **MCP Server**: `npx letsfg-mcp` — [npm](https://www.npmjs.com/package/letsfg-mcp)
- **Python SDK + CLI**: `pip install letsfg` — [PyPI](https://pypi.org/project/letsfg/)
- **Try without installing**: [letsfg.co](https://letsfg.co) — search instantly in your browser
- **GitHub**: [LetsFG/LetsFG](https://github.com/LetsFG/LetsFG)

> ⭐ **[Star the repo](https://github.com/LetsFG/LetsFG)** — we appreciate the support.

## License

MIT

## 🏨 Hotels — new, and live

Your agent can now book hotels, not just flights. Same API key, same card on file.

```python
from letsfg import LetsFG
lfg = LetsFG()

city = lfg.hotel_destinations("Warsaw")[0]
stays = lfg.search_hotels(
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12", adults=2,
)

hotel = stays["hotels"][0]
offer = hotel["offers"][0]
print(hotel["name"], offer["price"], stays["currency"])
# Hotel Gromada Warszawa Centrum 669.86 PLN

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

### How you pay

**5% now, the rest to the hotel later.** At booking we charge 5% of the price
to your card as a reservation fee. The remaining balance is paid **directly to
the supplier** through a `pay_link` we return — we never hold it.

`balance_due_by` is the supplier's own auto-cancellation date, not a date we
invent. Miss it and the room is released.

The 5% is **non-refundable**. Cancelling before `balance_due_by` costs nothing
else; after it, the hotel's own cancellation ladder applies and can reach 100%.
That ladder ships in the booking's `terms`, so you can always see the cost before
you cancel.

### What search costs

Search is metered separately from booking, on **either** auth path (free PFS
Bearer token or Developer API key — both count against the same agent):
**the first 1,000 `search_hotels` calls since your last hotel booking are
free.** Past that, searches are billed in blocks of 1,000 for **$5**
(~$0.005/search) from your prepaid balance — refused with a 402 if the
balance can't cover the next block, never silently allowed. Book a hotel
and the count resets to zero. Resolving a city name (`hotel_destinations`)
is not metered, only the search call itself.

### Things worth knowing before you build

- **A card on file is required for every hotel call, including search.** That is
  unusual and it is deliberate: a hotel search opens a real session at the
  supplier, and booking blocks a real rate. We would rather refuse up front than
  let you reach the point of commitment and discover you cannot pay. The same
  card that authorises flight booking authorises hotels — there is no separate
  hotel signup.
- **Only free-cancellation, pay-later rates are sold.** Those are the rates where
  the balance can safely be settled with the supplier after booking, which is
  what makes 5%-now/rest-later work at all. You will see fewer results than a
  metasearch shows you. Every one of them can actually be booked.
- **Booking is asynchronous.** `book_hotel` returns a `booking_job_id`, not a
  booking — the real thing takes minutes. Poll `hotel_booking(job_id)` until
  `status` is `succeeded` or `failed`, or call `book_hotel_and_wait` and let the
  SDK do it. This is not ceremony: it is what makes it impossible to charge a
  card and then lose the confirmation to a timeout.
- **The fee is charged before the room is committed.** A declined card therefore
  costs nothing to unwind — no reservation exists and nothing is charged.
- **Do not retry a booking blindly.** Calling `book_hotel` twice for the same
  rate books the room twice and charges two reservation fees.
- `price` is what the guest pays. There is no wholesale figure in the response to
  quote by mistake.

### JavaScript

```javascript
import { LetsFG } from 'letsfg';
const lfg = new LetsFG({ apiKey: process.env.LETSFG_API_KEY });

const [city] = await lfg.hotelDestinations('Warsaw');
const stays = await lfg.searchHotels({
  cityId: city.Id, cityName: city.Name,
  checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2,
});

const booking = await lfg.bookHotelAndWait({ /* ...offer + guest details... */ });
console.log(booking.confirmation, booking.pay_link);
```

### MCP

Five new tools, in the order you call them: `resolve_hotel_city` →
`search_hotels` → `book_hotel` → `get_hotel_booking` → `cancel_hotel_booking`.

