# LetsFG — Your AI agent just learned to book flights. (Node.js)

**Server-side search engine. Real prices. One function call.** Search hundreds of airlines at raw airline prices — **$20–$50 cheaper** than Booking.com, Kayak, and other OTAs. Zero dependencies. Built for AI agents.

[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![npm](https://img.shields.io/npm/v/letsfg)](https://www.npmjs.com/package/letsfg)

## Two ways to use LetsFG

| | **CLI / SDK** (this package) | **Developer API** |
|---|---|---|
| **Search cost** | Free (Twitter/X Bearer token via `letsfg auth`) | Prepaid credits |
| **Booking URL** | 1% concierge fee (min $3) via letsfg.co | Direct airline URL, no fee |
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
export LETSFG_BEARER_TOKEN=<your-bearer-token>

letsfg search GDN BER 2026-03-03 --sort price
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
