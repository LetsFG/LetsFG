# LetsFG — Your AI agent just learned to book flights. (Node.js)

**Server-side search engine. Real prices. One function call.** Search every airline in the world and the major booking sites; the price shown includes LetsFG's fee. Zero dependencies. Built for AI agents.

[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![npm](https://img.shields.io/npm/v/letsfg)](https://www.npmjs.com/package/letsfg)

## Two ways to use LetsFG

| | **CLI / SDK** (this package) | **Developer API** |
|---|---|---|
| **Search cost** | Free (card-backed token from [letsfg.co/connect](https://letsfg.co/connect), nothing charged) | Prepaid credits |
| **Booking** | `POST /api/agent-book` — fare held on your card, a LetsFG agent buys the ticket, captured only on a real PNR. Every offer. | Direct airline URL (unlock required first) |
| **Speed** | 8–10 s to first results; longer on a split | 2–5 s (discover) · 8–10 s to first results (full) |
| **Setup** | `npm install letsfg`, then connect at [letsfg.co/developers/api/mcp](https://letsfg.co/developers/api/mcp) | [letsfg.co/developers](https://letsfg.co/developers) |

> **Building a product, or need hotels?** Use the [Developer API](https://letsfg.co/developers) — look-to-book search (200 free after every booking, then $0.01), booking through `POST /flights/book`, no booking fee and no transaction fee.

## Install

```bash
npm install letsfg
```

## Getting a token

Connect LetsFG as an MCP server at `https://letsfg.co/developers/api/mcp` and
approve the connection — in Claude, ChatGPT, Cursor, Windsurf, or Claude Code
(`claude mcp add --transport http letsfg https://letsfg.co/developers/api/mcp`).
The consent step opens [letsfg.co/connect](https://letsfg.co/connect), where you
add a card (any card, or Revolut Pay / Google Pay) in a 0.00 Revolut setup.
Nothing is charged, no Revolut account is needed, and the card details go to
Revolut, never to LetsFG. The token you get back is card-backed: it searches
and it books. One card = one account; quotas are per card (10 searches per
10 min, 30 per hour, 100 per day — polling never counts).

Pass it as `bearerToken`, or set `LETSFG_BEARER_TOKEN` for the CLI.

> `letsfg auth` still runs the Stripe card setup that was retired on
> 2026-09-02 and cannot get a token today; every token issued that way was
> revoked (401 `TOKEN_REVOKED`). A connect-flow login for the CLI and SDKs is
> coming — until then, connect through the MCP.

## Quick Start (SDK)

```typescript
import { LetsFG, cheapestOffer, offerSummary } from 'letsfg';

// PFS — free. The card-backed token from the connect flow (see above).
const bt = new LetsFG({ bearerToken: 'eyJ...' });

// Search — FREE
const flights = await bt.search('GDN', 'BER', '2026-03-03');
const best = cheapestOffer(flights);
console.log(offerSummary(best));

// Book — no booking fee, no transaction fee — our margin is already in the price you saw; no unlock step. Starts the booking:
// the fare is HELD on your card and a LetsFG agent buys the ticket (4-11 min).
const result = await bt.book(
  best.id,
  [{
    given_name: 'John', family_name: 'Doe', born_on: '1990-01-15', gender: 'm',
    nationality: 'GB', phone_number: '+447700900123', phone_country: 'GB',
    address_line1: '1 Analytical Way', address_city: 'London',
    address_postal: 'N1 9GU', address_country: 'GB',
  }],
  'john@example.com',
  '',
  '',
  flights.search_id,
);
const bookingRef = result.booking_ref as string;

// Poll until it lands (every 20-30 s): completed | failed | needs_attention
let status: Record<string, unknown>;
do {
  await new Promise(r => setTimeout(r, 25_000));
  status = await (await fetch('https://letsfg.co/api/agent-book/status', {
    method: 'POST',
    headers: { Authorization: 'Bearer eyJ...', 'Content-Type': 'application/json' },
    body: JSON.stringify({ booking_ref: bookingRef }),
  })).json();
} while (status.state === 'booking_in_progress');
console.log(status); // { state: 'completed', pnr: 'ABC123', charged_amount: 93, currency: 'EUR' }
```

### How booking works

`bt.book()` posts to `POST /api/agent-book` and does exactly what the website
checkout does: the fare plus LetsFG's markup is **held** on the connected card
(not taken), a LetsFG booking agent buys the ticket from the seller, and the
hold is captured only once a real airline PNR exists. If the booking fails the
hold is released and nothing is charged. Every offer can be booked this way —
no unlock step, no booking-link fallback, no separate LetsFG fee.

The call returns within seconds with a `booking_ref`; the booking itself takes
4–11 minutes. Poll `POST /api/agent-book/status` with `{"booking_ref": ...}`
every 20–30 s (the SDK has no helper for this yet):

| `state` | Meaning |
|---|---|
| `booking_in_progress` | the agent is at the seller's checkout — keep waiting |
| `completed` | booked — `pnr`, `charged_amount`, `currency` are in the answer |
| `failed` | not booked — the hold was released, nothing charged; see `failure_reason` |
| `needs_attention` | a human at LetsFG is checking it — do **not** book again |

One traveller per call, with the details an airline checkout asks for: name,
date of birth, gender, nationality, email, phone with its country, residence
address (passport optional). A missing detail returns `missing_details` with
`missing_fields` and charges nothing. Never start a second booking for the
same trip while one is in progress — that would place a second hold.

Prefer the paid Developer API instead? Pass `apiKey` instead of `bearerToken` —
`search()`/`book()` dispatch automatically. That path needs a `searchId` (an offer
is bookable only inside the search that produced it) and has no unlock step:
`unlock()` was retired 2026-09-08, the route answers `410 Gone`, and there is no fee.

## Quick Start (CLI)

```bash
export LETSFG_BEARER_TOKEN=<your-bearer-token>  # card-backed, from the connect flow

letsfg search GDN BER 2026-03-03 --sort price
letsfg search LON BCN 2026-04-01 --json  # Machine-readable
letsfg book off_xxx --search-id srch_xxx -p '{"given_name":"John","family_name":"Doe","born_on":"1990-01-15","gender":"m","nationality":"GB","phone_number":"+447700900123","phone_country":"GB","address_line1":"1 Analytical Way","address_city":"London","address_postal":"N1 9GU","address_country":"GB"}' -e john@example.com
# prints the booking_ref — poll POST /api/agent-book/status until completed
```

## API

### `new LetsFG({ bearerToken?, apiKey?, baseUrl?, timeout? })`

### `bt.search(origin, destination, dateFrom, options?)`
### `bt.resolveLocation(query)`
### `bt.book(offerId, passengers, contactEmail, contactPhone?, idempotencyKey?, searchId?)`
Dispatches on which credential is set: `bearerToken` → PFS booking via
`POST /api/agent-book` (pass `searchId`, one passenger with full details;
returns `booking_ref` — poll `POST /api/agent-book/status`). `apiKey` → paid
Developer API `book` (requires `searchId`, no unlock step, supports multiple
passengers and `idempotencyKey`; returns a `booking_id` to poll).
### `bt.getBooking(bookingId)` / `bt.answerBooking(...)` / `bt.bookAndWait(...)` — Developer API only
### `bt.connectPayment()` — Developer API only. Returns `connect_url`; nothing is charged
### `bt.setupPayment()` / `bt.unlock()` — **retired 2026-09-08, both throw locally**
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

Your agent can book hotels as well as flights. Same card-backed token or API key, same connected payment method.

> **Update your SDK before booking hotels.** Hotel booking needs **letsfg 2026.5.101** or later (Python),
> **letsfg 2026.5.74** or later (JavaScript/TypeScript) or **letsfg-mcp 2026.5.77** or later. Earlier releases send
> the reservation-fee fields retired on 2026-09-11 (`expected_balance`, no `expected_cost`), and the API refuses
> every hotel booking they make. Update with `pip install -U letsfg`, `npm install letsfg@latest` or
> `npx -y letsfg-mcp@latest`. The hosted MCP at `https://letsfg.co/developers/api/mcp` needs no update.

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
print(hotel["name"], offer["price"], offer["currency"], offer["refundable"])
# prices are in stays["currency"]: USD unless you pass currency=

booking = lfg.book_hotel_and_wait(
    session_id=offer["session_id"],
    hotel_code=hotel["hotel_code"],
    combination_id_v2=offer["combination_id_v2"],
    expected_price=offer["price"],          # copy these four from the offer, verbatim
    expected_cost=offer["expected_cost"],
    currency=offer["currency"],
    fx_rate=offer["fx_rate"],
    city_id=city["Id"], city_name=city["Name"],
    check_in="2026-11-10", check_out="2026-11-12",
    # ONE entry per guest in the room, children included: adults first, then children in child_ages order
    guests=[{"title": "Mr", "first_name": "Jan", "last_name": "Kowalski"},
            {"title": "Mrs", "first_name": "Anna", "last_name": "Kowalska"}],
    email="GUEST_EMAIL", phone="512345678",   # the guest's real e-mail and phone
)
if booking["status"] == "succeeded":
    print(booking["confirmation"], booking["total_price"], booking["currency"])
elif booking["status"] == "failed":
    print("Not booked, nothing charged:", booking["error"])
else:  # "attention": a person is checking it with the supplier, the hold is kept. Do not book again.
    print(booking["status"], booking.get("error"))
```

### How you pay

**The full price is held, and taken only once the hotel confirms.** Booking holds the offer's
`price` on the Revolut payment method connected to your account — authorised, not charged.
LetsFG then books the room with the supplier and pays the supplier itself. The hold is captured
only after the supplier has confirmed the booking; if the booking fails for any reason (the rate
is gone, the price moved, the supplier declined, a guest detail was rejected), the hold is
released and nothing is charged.

There is **no reservation fee, no deposit and no pay link**, and the guest owes the hotel nothing
further. (Those belonged to the process retired on 2026-09-11.)

`price` is the supplier's cost plus 6.4% (our margin and payment processing) for Revolut Pay or a
card issued in the EEA, or 8.3% for a card issued outside the EEA — the search response's
`markup_rate` says which. Nothing is added at booking. Prices are in the currency you search in:
USD unless you ask for another.

Cancelling a refundable rate before its `free_cancellation_until` costs nothing and refunds the
charge in full. A cancellation that would cost money is refused (409); the hotel's own ladder is in
the booking's `terms`.

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

- **A connected payment method is required for every hotel call, including search.** A hotel
  search opens a real session at the supplier and booking blocks a real rate, so we refuse up
  front rather than let you reach the point of commitment and discover you cannot pay. The same
  method authorises flights and hotels — there is no separate hotel signup.
- **Every rate type is sold**, refundable and non-refundable. Each offer's `refundable` and
  `free_cancellation_until` say which one you are buying.
- **Booking is asynchronous.** `book_hotel` returns a `booking_job_id`, not a booking — the real
  thing takes minutes. Poll `hotel_booking(job_id)` every ~20 s until `status` is `succeeded`,
  `failed` or `attention`, or call `book_hotel_and_wait` and let the SDK do it. All three are final:
  - `succeeded` — `confirmation`, `total_price` + `currency` (what the guest is charged),
    `supplier_paid` + `supplier_currency`, `refundable`, `free_cancellation_until`,
    `cancellation_ladder` and `terms`.
  - `failed` — `error`, written for the guest. The hold has been released; nothing was charged.
  - `attention` — the outcome could not be settled automatically. The hold is kept (nothing is
    charged) while a person checks with the supplier. Do not book again.
- **Copy the offer verbatim.** Send `expected_price` (the offer's `price`), `expected_cost`,
  `currency` and `fx_rate` exactly as search returned them. A mis-copied price, or a USD offer sent
  without its `currency`, is refused with `400 price_mismatch` before anything is held.
- **Guest details are checked before anything is held**: Latin-script names, a phone number valid
  for its country code, and an e-mail. A problem returns `400 invalid_details` naming the fields.
- **One name per guest in the room, children included.** For a family, search with `children` and
  `child_ages`; the party travels with the offer's session. `guests` then lists every guest — adults
  first, then children in `child_ages` order. The hotel requires a name for every guest: fewer names
  than guests is refused before anything is submitted, and the hold is released.
- **The guest is e-mailed however it ends**: a confirmation with the code and the cancellation
  term, a note that it did not go through and nothing was charged, or a note that it is being
  confirmed with the supplier.
- **A retry never books twice.** A second `book_hotel` for the same rate and guest returns the job
  already under way (`duplicate: true`); pass `idempotency_key` to make that explicit. Still, never
  re-post a booking whose job is running — poll it.

### JavaScript

```javascript
import { LetsFG } from 'letsfg';
const lfg = new LetsFG({ apiKey: process.env.LETSFG_API_KEY });

const [city] = await lfg.hotelDestinations('Warsaw');
const stays = await lfg.searchHotels({
  cityId: city.Id, cityName: city.Name,
  checkIn: '2026-11-10', checkOut: '2026-11-12', adults: 2,
});

const hotel = stays.hotels[0];
const offer = hotel.offers[0];
const booking = await lfg.bookHotelAndWait({
  sessionId: offer.session_id, hotelCode: hotel.hotel_code,
  combinationIdV2: offer.combination_id_v2,
  expectedPrice: offer.price, expectedCost: offer.expected_cost,
  currency: offer.currency, fxRate: offer.fx_rate,
  cityId: city.Id, cityName: city.Name,
  checkIn: '2026-11-10', checkOut: '2026-11-12',
  // ONE entry per guest in the room, children included: adults first, then children in childAges order
  guests: [{ title: 'Mr', first_name: 'Jan', last_name: 'Kowalski' },
    { title: 'Mrs', first_name: 'Anna', last_name: 'Kowalska' }],
  email: 'GUEST_EMAIL', phone: '512345678',
});
console.log(booking.status, booking.confirmation, booking.total_price, booking.currency);
```

### MCP

Five new tools, in the order you call them: `resolve_hotel_city` →
`search_hotels` → `book_hotel` → `get_hotel_booking` → `cancel_hotel_booking`.

