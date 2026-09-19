# Packages

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

LetsFG is available as a Python SDK, JavaScript SDK, MCP server, and remote MCP endpoint. Works with OpenClaw, Perplexity Computer, Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent.

## Overview

Every package below covers **flights and hotels**, on **one credential**: the token you get by connecting the MCP (one tap at <https://letsfg.co/connect>, no card), or a Developer API key. Flights ask for the card at the first booking. Hotels need a card on file for search as well as booking — see [Hotels](hotels.md).

| Package | Install | What it is | API Key Required? |
|---------|---------|------------|-------------------|
| **Python SDK + CLI** | `pip install letsfg` | SDK + CLI, server-side search via letsfg.co | Card-backed token in `LETSFG_BEARER_TOKEN` or Developer API key |
| **JS/TS SDK + CLI** | `npm install -g letsfg` | SDK + `letsfg` CLI command | Free Bearer token or Developer API key |
| **MCP Server** | `npx letsfg-mcp` | Model Context Protocol for AI agents | Free Bearer token or Developer API key |
| **Remote MCP** | `https://letsfg.co/developers/api/mcp` | Streamable HTTP — no install needed; **the way to connect** (one-tap OAuth consent, no card) | Nothing up front — connect and approve |
| **Smithery** | [smithery.ai/servers/letsfg](https://smithery.ai/servers/letsfg) | One-click MCP install | Free token or Developer API key |

!!! warning "Update your SDK before booking hotels"
    Hotel booking needs **letsfg 2026.5.101** or later (Python), **letsfg 2026.5.74** or later
    (JavaScript/TypeScript) and **letsfg-mcp 2026.5.77** or later. Earlier releases send the
    reservation-fee fields retired on 2026-09-11 (`expected_balance`, no `expected_cost`), and the API
    refuses every hotel booking they make. Update with `pip install -U letsfg`,
    `npm install letsfg@latest` or `npx -y letsfg-mcp@latest`. The hosted MCP at
    <https://letsfg.co/developers/api/mcp> needs no update.

## Python SDK

[![PyPI](https://img.shields.io/pypi/v/letsfg)](https://pypi.org/project/letsfg/)

```bash
pip install letsfg
```

Provides:

- `LetsFG` client class with `search()`, `book()`, `me()`, `resolve_location()`. `unlock()` and `setup_payment()` call routes retired on 2026-09-08 and now answer `410 Gone`
- Server-side search via letsfg.co — Ryanair, Wizz Air, EasyJet, Norwegian, AirAsia, IndiGo, Qatar Airways, LATAM, Finnair, and every other airline
- CLI command `letsfg` with all operations (`letsfg auth` connects at letsfg.co/connect and stores the token)
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

- `LetsFG` client class with `search()`, `book()`, `me()`. `unlock()` calls a route retired on 2026-09-08
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

The local MCP server connects to the letsfg.co server-side engine. It needs a credential in its environment: `LETSFG_BEARER_TOKEN` (a card-backed token from the connect flow) for free flight search and booking, or `LETSFG_API_KEY` for the Developer API. If your client supports remote MCP servers, prefer the [remote endpoint](#remote-mcp-streamable-http) below — it needs no install and no token handling.

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
| `LETSFG_BEARER_TOKEN` | (none) | Card-backed token from the connect flow. Reaches **flights and hotels** |
| `LETSFG_API_KEY` | (none) | Developer API key (look-to-book search). Also reaches both; required for the account and payment tools |
| `LETSFG_BASE_URL` | `https://letsfg.co/developers` | Override the website-owned public API base |

### Remote MCP (Streamable HTTP)

If your client supports remote MCP servers, connect directly without installing anything:

```
https://letsfg.co/developers/api/mcp
```

This is the recommended way in. Point your client at the URL and approve the connection: the OAuth consent step opens <https://letsfg.co/connect>: one tap, no card. The token your client receives searches straight away. The card is asked for at the first booking, in a 0.00 Revolut setup (any card, or Revolut Pay / Google Pay — no Revolut account needed). A Developer API key also works (`X-API-Key` header) for the paid product.

```bash
# Claude Code
claude mcp add --transport http letsfg https://letsfg.co/developers/api/mcp
```

```json
// Cursor (.cursor/mcp.json) — Windsurf uses "serverUrl" instead of "url"
{ "mcpServers": { "letsfg": { "url": "https://letsfg.co/developers/api/mcp" } } }
```

### Available Tools

**Flights**

| Tool | Description | Auth |
|------|-------------|------|
| `search_flights` | Search via the letsfg.co server-side engine | Bearer or API key |
| `resolve_location` | Convert city names to IATA codes | API key |
| `unlock_flight_offer` | **RETIRED 2026-09-08** — the route answers `410 Gone`. There is no unlock step on either lane; call `book_flight` (PFS) or `POST /flights/book` (Developer API) directly | API key |
| `book_flight` | Start the booking: the price shown is held on the connected card, a LetsFG booking agent buys the ticket, and the hold is captured only against a real PNR. Returns a `booking_ref` in seconds; the booking takes 4–11 min | Bearer or API key |
| `get_flight_booking` | Poll a started booking every 20–30 s: `booking_in_progress` → `completed` (PNR) / `failed` (hold released) / `needs_attention` (do not book again) | Bearer |

**Hotels** — need a card on file (a search opens a real supplier session). Either credential works.

| Tool | Description | Auth |
|------|-------------|------|
| `resolve_hotel_city` | Resolve a place name to the supplier city id `search_hotels` needs. Call this first | API key |
| `search_hotels` | Search real, bookable rates, every rate type. Each offer says `refundable` / `free_cancellation_until`. Needs a card on file — a search opens a real supplier session. Takes up to a few minutes | API key + card |
| `book_hotel` | Book one rate. The **full price is held** on the connected Revolut method and captured only once the hotel confirms; a failed booking releases the hold. `guests` needs one name per person in the room, children included (adults first). Returns a `booking_job_id`, not a booking | API key + card |
| `get_hotel_booking` | Poll the booking job until `succeeded`, `failed` or `attention` (a person is confirming it; the hold is kept — do not book again). **Never call `book_hotel` again while a job is running** | API key |
| `cancel_hotel_booking` | Cancel a refundable booking before `free_cancellation_until` — 98% refunded (2% cancellation fee) | API key |

**Account and setup**

| Tool | Description | Auth |
|------|-------------|------|
| `authenticate` | Returns the current connect instructions and `add_card_url` (letsfg.co/connect). A person approves once in a browser; nothing is charged. The Stripe lanes it used to drive were retired on 2026-09-02 | none |
| `connect_payment` | **[Developer API only]** Mint a one-time link to connect a payment method to the paid prepaid account (nothing is charged). Not how agents authenticate | API key |
| `get_agent_profile` | View account info and usage stats | API key |
| `load_resources` | Load the in-server usage guide | none |

[npm page →](https://www.npmjs.com/package/letsfg-mcp)

### Which MCP path should you use?

| Path | Search mode | Auth | Best for |
|------|-------------|------|----------|
| `https://letsfg.co/developers/api/mcp` | Server-side at letsfg.co | Approve the connection (one tap, no card) | **Recommended.** No install — flights, hotels and booking over Streamable HTTP in Claude, ChatGPT, Cursor, Windsurf |
| `npx letsfg-mcp` | Server-side at letsfg.co | `LETSFG_BEARER_TOKEN` (card-backed token) or Developer API key | Clients that cannot do remote MCP |

## API Endpoints

Public REST integrations use the letsfg.co developer API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agents/register` | POST | Create developer account, get API key |
| `/agents/connect-payment` | POST | Mint a one-time `connect_url` to save a Revolut method. Nothing is charged to connect |
| `/agents/top-up` | POST | Fund prepaid developer balance |
| `/agents/me` | GET | Developer profile and balance |
| `/flights/search` | POST | Search flights through the public API (consumes prepaid balance) |
| `/flights/locations/{query}` | GET | Resolve city/airport codes |
| `/flights/providers` | GET | Inspect provider mix |
| `/hotels/destinations` | POST | Resolve a place name to a supplier city id |
| `/hotels/search` | POST | Search bookable hotel rates, every rate type |
| `/hotels/book` | POST | Start a booking (async — returns a job id) |
| `/hotels/booking/{job_id}` | GET | Collect the booking result |
| `/hotels/cancel` | POST | Release a reservation |

**Base URL:** `https://letsfg.co/developers/api/v1`

**Interactive docs:** [letsfg.co/developers/api/docs](https://letsfg.co/developers/api/docs)

See also: [Public API overview](api-guide.md), [Onboarding and Billing](api-onboarding.md), and [Search and Results](api-search.md).
