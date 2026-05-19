# Packages

LetsFG is available as a Python SDK, JavaScript SDK, MCP server, and remote MCP endpoint. Works with OpenClaw, Perplexity Computer, Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent.

## Overview

| Package | Install | What it is | API Key Required? |
|---------|---------|------------|-------------------|
| **Python SDK + CLI** | `pip install letsfg` | SDK + CLI + 200 local airline connectors | No (local search). Yes (cloud search, unlock, book) |
| **JS/TS SDK + CLI** | `npm install -g letsfg` | SDK + `letsfg` CLI command | Yes |
| **MCP Server** | `npx letsfg-mcp` | Model Context Protocol for AI agents | No (local search). Yes (cloud search, unlock, book) |
| **Remote MCP** | `https://letsfg.co/developers/api/mcp` | Streamable HTTP — no install needed | Yes |
| **Smithery** | [smithery.ai/server/letsfg-mcp](https://smithery.ai/server/letsfg-mcp) | One-click MCP install | No (local search). Yes (cloud search) |

## Python SDK

[![PyPI](https://img.shields.io/pypi/v/letsfg)](https://pypi.org/project/letsfg/)

```bash
pip install letsfg
```

Provides:

- `LetsFG` client class with `search()`, `unlock()`, `book()`, `me()`, `resolve_location()`, `setup_payment()`
- **200 local airline connectors** — run directly on your machine (Ryanair, Wizz Air, EasyJet, Norwegian, AirAsia, IndiGo, Qatar Airways, LATAM, Finnair, and 190+ more)
- `search_local()` — free local-only search, no API key needed
- `get_system_profile()` — detect system RAM/CPU and recommended concurrency
- `configure_max_browsers(n)` — set max concurrent browser instances (1–32)
- CLI command `letsfg` with all operations
- Virtual interlining engine — cross-airline round-trips from one-way fares
- Shared browser infrastructure — stealth Chrome launcher, CDP sessions, anti-bot handling
- Typed response models: `FlightSearchResponse`, `UnlockResponse`, `BookingResponse`, `AgentProfile`
- Exception classes: `AuthenticationError`, `PaymentRequiredError`, `OfferExpiredError`

```python
from letsfg import LetsFG

bt = LetsFG(api_key="trav_...")
flights = bt.search("LHR", "JFK", "2026-04-15")
```

### Local Search (No API Key)

```python
from letsfg.local import search_local

# Free, runs all relevant LCC connectors on your machine
result = await search_local("GDN", "BCN", "2026-06-15")
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

const bt = new LetsFG({ apiKey: 'trav_...' });
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

By default, the npm MCP server runs search locally on your machine by spawning `python -m letsfg.local`. That gives you free local connector search without routing flight search through the paid public API.

### Local prerequisites

```bash
pip install letsfg
playwright install chromium
```

Add `LETSFG_API_KEY` only when you want account-linked operations such as payment setup, unlock, booking, or profile inspection.

### Configuration

Add to your MCP config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_API_KEY": "trav_your_api_key"
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LETSFG_API_KEY` | (none) | API key for account, payment, unlock, and booking operations |
| `LETSFG_BASE_URL` | `https://letsfg.co/developers` | Override the website-owned public API base |
| `LETSFG_PYTHON` | `python3` | Override the Python executable used for local search |

### Remote MCP (Streamable HTTP)

If your client supports remote MCP servers, connect directly without installing anything:

```
https://letsfg.co/developers/api/mcp
```

Remote MCP follows the same paid public API lifecycle as direct REST usage: register, attach Stripe, top up prepaid balance, then search.

For the exact onboarding flow, use [Onboarding and Billing](api-onboarding.md).

### Available Tools

| Tool | Description |
|------|-------------|
| `search_flights` | Search locally by default; remote MCP uses the paid public developer API |
| `get_agent_profile` | View account info and usage stats |
| `resolve_location` | Convert city names to IATA codes |
| `system_info` | System resources & recommended concurrency |
| `setup_payment` | Attach a Stripe payment method |
| `unlock_flight_offer` | Confirm price and reserve (payment required) |
| `book_flight` | Create airline booking after unlock |

[npm page →](https://www.npmjs.com/package/letsfg-mcp)

### Which MCP path should you use?

| Path | Search mode | Billing | Best for |
|------|-------------|---------|----------|
| `npx letsfg-mcp` | Local on your machine | Optional for account-linked actions | Free connector search in Claude, Cursor, and Windsurf |
| `https://letsfg.co/developers/api/mcp` | Managed public search | Required | Hosted, account-managed search through the paid public API |

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

**Base URL:** `https://letsfg.co/developers/api/v1`

**Interactive docs:** [letsfg.co/developers/api/docs](https://letsfg.co/developers/api/docs)

See also: [Public API overview](api-guide.md), [Onboarding and Billing](api-onboarding.md), and [Search and Results](api-search.md).
