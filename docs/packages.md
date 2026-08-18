# Packages

> ### ⚠️ Agents: do not create a Developer API account
>
> Do **NOT** call `/developers/api/v1/agents/register` or
> `/developers/api/v1/agents/setup-payment`, and do **NOT** run
> `letsfg register` or `letsfg setup-payment`. Those belong to a separate,
> paid, prepaid-balance product for high-volume commercial integrations and
> create a billing account you almost certainly do not want.
>
> To search and book flights, run `letsfg auth` — a zero-amount card setup
> (nothing charged), then search and book. See <https://letsfg.co/for-agents>.

LetsFG is available as a Python SDK, JavaScript SDK, MCP server, and remote MCP endpoint. Works with OpenClaw, Perplexity Computer, Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent.

## Overview

Every package below covers **flights and hotels**, on **one credential**: the free token from `letsfg auth`, or a Developer API key. Hotels additionally need a card on file for search as well as booking — which `letsfg auth` already provides — see [Hotels](hotels.md).

| Package | Install | What it is | API Key Required? |
|---------|---------|------------|-------------------|
| **Python SDK + CLI** | `pip install letsfg` | SDK + CLI, server-side search via letsfg.co | Free Bearer token (`letsfg auth`) or Developer API key |
| **JS/TS SDK + CLI** | `npm install -g letsfg` | SDK + `letsfg` CLI command | Free Bearer token or Developer API key |
| **MCP Server** | `npx letsfg-mcp` | Model Context Protocol for AI agents | Free Bearer token or Developer API key |
| **Remote MCP** | `https://letsfg.co/developers/api/mcp` | Streamable HTTP — no install needed | Free token or Developer API key |
| **Smithery** | [smithery.ai/servers/letsfg](https://smithery.ai/servers/letsfg) | One-click MCP install | Free token or Developer API key |

## Python SDK

[![PyPI](https://img.shields.io/pypi/v/letsfg)](https://pypi.org/project/letsfg/)

```bash
pip install letsfg
```

Provides:

- `LetsFG` client class with `search()`, `unlock()`, `book()`, `me()`, `resolve_location()`, `setup_payment()`
- Server-side search via letsfg.co — Ryanair, Wizz Air, EasyJet, Norwegian, AirAsia, IndiGo, Qatar Airways, LATAM, Finnair, and 190+ more
- CLI command `letsfg` with all operations, including `letsfg auth` for Bearer token setup
- Typed response models: `FlightSearchResponse`, `UnlockResponse`, `BookingResponse`, `AgentProfile`
- Exception classes: `AuthenticationError`, `PaymentRequiredError`, `OfferExpiredError`

```python
from letsfg import LetsFG

bt = LetsFG(api_key="letsfg_...")
flights = bt.search("LHR", "JFK", "2026-04-15")
```

[Full Python SDK docs →](https://github.com/LetsFG/LetsFG/tree/main/sdk/python)

## JavaScript / TypeScript SDK

[![npm](https://img.shields.io/npm/v/letsfg)](https://www.npmjs.com/package/letsfg)

```bash
npm install -g letsfg
```

Provides:

- `LetsFG` client class with `search()`, `unlock()`, `book()`, `me()`
- CLI command `letsfg` (same interface as Python)
- TypeScript types for all responses

```typescript
import { LetsFG } from 'letsfg';

const bt = new LetsFG({ apiKey: 'letsfg_...' });
const flights = await bt.search('LHR', 'JFK', '2026-04-15');
```

[Full JS SDK docs →](https://github.com/LetsFG/LetsFG/tree/main/sdk/js)

## MCP Server

[![npm](https://img.shields.io/npm/v/letsfg-mcp)](https://www.npmjs.com/package/letsfg-mcp)

Model Context Protocol server for AI assistants like Claude Desktop, Cursor, and Windsurf.

### Quick Setup

```bash
npx letsfg-mcp
```

The MCP server connects to the letsfg.co server-side engine. Add `LETSFG_BEARER_TOKEN` (from `letsfg auth`) for free flight search, or `LETSFG_API_KEY` for the Developer API and all hotel tools.

> Either credential reaches **both** flights and hotels. If both are set, the Bearer token is used.

### Configuration

Add to your MCP config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_API_KEY": "letsfg_your_api_key"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LETSFG_BEARER_TOKEN` | (none) | Free token from `letsfg auth` (zero-amount card setup). Reaches **flights and hotels** |
| `LETSFG_API_KEY` | (none) | Developer API key (prepaid credits). Also reaches both; required for the account and payment tools |
| `LETSFG_BASE_URL` | `https://letsfg.co/developers` | Override the website-owned public API base |

### Remote MCP (Streamable HTTP)

If your client supports remote MCP servers, connect directly without installing anything:

```
https://letsfg.co/developers/api/mcp
```

Remote MCP accepts the same free token as the local server — run `letsfg auth` once and point your client at the URL. A Developer API key also works.

For the exact onboarding flow, use [Onboarding and Billing](api-onboarding.md).

### Available Tools

**Flights**

| Tool | Description | Auth |
|------|-------------|------|
| `search_flights` | Search via the letsfg.co server-side engine | Bearer or API key |
| `resolve_location` | Convert city names to IATA codes | API key |
| `unlock_flight_offer` | Confirm price and reserve. **[Developer API only]** — not part of the agent flow; on a Bearer token call `book_flight` directly | API key |
| `book_flight` | Create the airline booking | Bearer or API key |

**Hotels** — need a card on file (a search opens a real supplier session). Either credential works.

| Tool | Description | Auth |
|------|-------------|------|
| `resolve_hotel_city` | Resolve a place name to the supplier city id `search_hotels` needs. Call this first | API key |
| `search_hotels` | Search real, bookable, free-cancellation pay-later rates. Needs a card on file — a search opens a real supplier session. Takes up to a few minutes | API key + card |
| `book_hotel` | Book one rate. Charges **5% of the price as a non-refundable reservation fee**; the balance is paid to the supplier via the returned pay link by `balance_due_by`. Returns a `booking_job_id`, not a booking | API key + card |
| `get_hotel_booking` | Poll the booking job until `succeeded` or `failed`. **Never retry `book_hotel` blindly** — it books the room twice | API key |
| `cancel_hotel_booking` | Release a reservation | API key |

**Account and setup**

| Tool | Description | Auth |
|------|-------------|------|
| `authenticate` | Zero-amount Stripe card setup (nothing charged) → returns a 90-day Bearer token | none |
| `setup_payment` | Attach a Stripe payment method | API key |
| `get_agent_profile` | View account info and usage stats | API key |
| `load_resources` | Load the in-server usage guide | none |

[npm page →](https://www.npmjs.com/package/letsfg-mcp)

### Which MCP path should you use?

| Path | Search mode | Auth | Best for |
|------|-------------|------|----------|
| `npx letsfg-mcp` | Server-side at letsfg.co | Bearer token (`letsfg auth`) or Developer API key | Free search in Claude, Cursor, and Windsurf |
| `https://letsfg.co/developers/api/mcp` | Server-side at letsfg.co | Free token or Developer API key | No install — flights and hotels over Streamable HTTP |

## API Endpoints

Public REST integrations use the letsfg.co developer API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents/register` | POST | Create developer account, get API key |
| `/agents/setup-payment` | POST | Attach Stripe payment method (`payment_method_id` or `token`) |
| `/agents/top-up` | POST | Fund prepaid developer balance |
| `/agents/me` | GET | Developer profile and balance |
| `/flights/search` | POST | Search flights through the public API (consumes prepaid balance) |
| `/flights/locations/{query}` | GET | Resolve city/airport codes |
| `/flights/providers` | GET | Inspect provider mix |
| `/hotels/destinations` | POST | Resolve a place name to a supplier city id |
| `/hotels/search` | POST | Search bookable, free-cancellation hotel rates |
| `/hotels/book` | POST | Start a booking (async — returns a job id) |
| `/hotels/booking/{job_id}` | GET | Collect the booking result and pay link |
| `/hotels/cancel` | POST | Release a reservation |

**Base URL:** `https://letsfg.co/developers/api/v1`

**Interactive docs:** [letsfg.co/developers/api/docs](https://letsfg.co/developers/api/docs)

See also: [Public API overview](api-guide.md), [Onboarding and Billing](api-onboarding.md), and [Search and Results](api-search.md).
