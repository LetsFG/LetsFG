# LetsFG — Your AI agent just learned to book flights. (Node.js)

**200+ airline connectors. Real prices. One function call.** Search 400+ airlines at raw airline prices — **$20–$50 cheaper** than Booking.com, Kayak, and other OTAs. Zero dependencies. Built for AI agents.

[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![npm](https://img.shields.io/npm/v/letsfg)](https://www.npmjs.com/package/letsfg)

## Three ways to use LetsFG

| | **Local** (this SDK) | **PFS** (Programmatic Flight Search via letsfg.co) | **Developer API** |
|---|---|---|---|
| **Search cost** | Free | Free (Twitter/X token, one-time setup) | Prepaid credits |
| **Booking URL** | 1% concierge fee (min $3) via letsfg.co | 1% concierge fee (min $3) via letsfg.co | Direct airline URL, no fee |
| **Speed** | 20–40 s (fast mode) · 1–15 min (full) | 60–90 s | 2–5 s (discover) · 60–90 s (full) |
| **Setup** | `npm install letsfg` | Twitter/X challenge → [letsfg.co/for-agents](https://letsfg.co/for-agents) | [letsfg.co/developers](https://letsfg.co/developers) |

> **Want direct airline URLs without any per-booking fee?** Use the [Developer API](https://letsfg.co/developers) — prepaid credits, results in seconds, no checkout step.

## Install

```bash
npm install letsfg
```

## Quick Start (SDK)

```typescript
import { LetsFG, cheapestOffer, offerSummary } from 'letsfg';

// Register (one-time)
const creds = await LetsFG.register('my-agent', 'agent@example.com');
console.log(creds.api_key); // Save this

// Use
const bt = new LetsFG({ apiKey: 'trav_...' });

// Search — FREE
const flights = await bt.search('GDN', 'BER', '2026-03-03');
const best = cheapestOffer(flights);
console.log(offerSummary(best));

// Unlock
const unlock = await bt.unlock(best.id);

// Book
const booking = await bt.book(
  best.id,
  [{
    id: flights.passenger_ids[0],
    given_name: 'John',
    family_name: 'Doe',
    born_on: '1990-01-15',
    gender: 'm',
    title: 'mr',
    email: 'john@example.com',
  }],
  'john@example.com'
);
console.log(`PNR: ${booking.booking_reference}`);
```

## Quick Start (CLI)

```bash
export LETSFG_API_KEY=trav_...

letsfg search GDN BER 2026-03-03 --sort price

# Fast mode — OTAs + key airlines only (~25 connectors, 20-40s)
letsfg search GDN BER 2026-03-03 --mode fast
letsfg search LON BCN 2026-04-01 --json  # Machine-readable
letsfg unlock off_xxx
letsfg book off_xxx -p '{"id":"pas_xxx","given_name":"John",...}' -e john@example.com
```

## API

### `new LetsFG({ apiKey, baseUrl?, timeout? })`

### `bt.search(origin, destination, dateFrom, options?)`
### `bt.resolveLocation(query)`
### `bt.unlock(offerId)`
### `bt.book(offerId, passengers, contactEmail, contactPhone?)`
### `bt.setupPayment(token?)`
### `bt.me()`
### `LetsFG.register(agentName, email, baseUrl?, ownerName?, description?)`

### Helpers
- `offerSummary(offer)` — One-line string summary
- `cheapestOffer(result)` — Get cheapest offer from search

### `searchLocal(origin, destination, dateFrom, options?)`

Search 200 airline connectors locally (no API key needed). Requires Python + `letsfg` installed.

> **Note:** Local search results return masked booking links by default. Each offer includes `offer_ref` and `payment_token` fields. To get a direct airline booking URL, use the **concierge unlock flow** (1% fee, min $3 — no API key needed) or sign up for the **Developer API** at [letsfg.co/developers](https://letsfg.co/developers) for fee-free direct links.

```typescript
import { searchLocal } from 'letsfg';

const result = await searchLocal('GDN', 'BCN', '2026-06-15');
console.log(result.total_results);

// Limit browser concurrency for constrained environments
const result2 = await searchLocal('GDN', 'BCN', '2026-06-15', { maxBrowsers: 4 });
```

### Unlocking offer results

Local search results include `offer_ref` and `payment_token` on each offer. Use these to retrieve the direct airline booking URL via the concierge flow (no API key required):

```typescript
import { searchLocal } from 'letsfg';

const result = await searchLocal('GDN', 'BCN', '2026-06-15');
const offer = result.offers[0];

// 1. Initiate checkout — fee = max(price × 1%, $3.00). No API key needed.
const checkoutRes = await fetch('https://letsfg.co/api/developers/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    offer_id:      offer.id,
    offer_ref:     offer.offer_ref,
    payment_token: offer.payment_token,
    currency:      offer.currency,
    price:         String(offer.price),
  }),
});
const { checkout_url } = await checkoutRes.json();

// 2. Present checkout_url to the user (or open it programmatically)
console.log(`Pay here: ${checkout_url}`);

// 3. Poll until payment is confirmed
async function pollVerify(token: string): Promise<string> {
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(
      `https://letsfg.co/api/developers/payment-verify?token=${token}`
    );
    const data = await res.json();
    if (data.verified) return data.booking_url;
  }
}

// 4. booking_url is the direct airline link — no further fees
const bookingUrl = await pollVerify(offer.payment_token);
console.log(`Book here: ${bookingUrl}`);
```

To skip the per-booking fee entirely, use the [Developer API](https://letsfg.co/developers) — it returns direct airline booking URLs on every search result.

### `systemInfo()`

Get system resource profile and recommended concurrency settings.

```typescript
import { systemInfo } from 'letsfg';

const info = await systemInfo();
console.log(info);
// { platform: 'win32', cpu_cores: 16, ram_total_gb: 31.2, ram_available_gb: 14.7,
//   tier: 'standard', recommended_max_browsers: 8, current_max_browsers: 8 }
```

## Zero Dependencies

Uses native `fetch` (Node 18+). No `axios`, no `node-fetch`, nothing. Safe for sandboxed environments.

## Performance Tuning

Local search auto-scales browser concurrency based on available RAM. Override with `maxBrowsers`:

```typescript
// Limit to 4 concurrent browsers
await searchLocal('LHR', 'BCN', '2026-04-15', { maxBrowsers: 4 });
```

Or set the `LETSFG_MAX_BROWSERS` environment variable globally.

## Also Available As

- **MCP Server**: `npx letsfg-mcp` — [npm](https://www.npmjs.com/package/letsfg-mcp)
- **Python SDK + CLI**: `pip install letsfg` — [PyPI](https://pypi.org/project/letsfg/)
- **Try without installing**: [letsfg.co](https://letsfg.co) — search instantly in your browser
- **GitHub**: [LetsFG/LetsFG](https://github.com/LetsFG/LetsFG)

> ⭐ **[Star the repo](https://github.com/LetsFG/LetsFG)** — we appreciate the support.

## License

MIT
