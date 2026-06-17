# Packages

LetsFG is available as a Python SDK, JavaScript SDK, MCP server, and remote MCP endpoint. Works with OpenClaw, Perplexity Computer, Claude Desktop, Cursor, Windsurf, and any MCP-compatible agent.

## Overview

| Package | Install | What it is | API Key Required? |
|---------|---------|------------|-------------------|
| **Python SDK + CLI** | `pip install letsfg` | SDK + CLI, server-side search via letsfg.co | Free Bearer token (`letsfg auth`) or Developer API key |
| **JS/TS SDK + CLI** | `npm install -g letsfg` | SDK + `letsfg` CLI command | Free Bearer token or Developer API key |
| **MCP Server** | `npx letsfg-mcp` | Model Context Protocol for AI agents | Free Bearer token or Developer API key |
| **Remote MCP** | `https://letsfg.co/developers/api/mcp` | Streamable HTTP — no install needed | Developer API key |
| **Smithery** | [smithery.ai/server/letsfg-mcp](https://smithery.ai/server/letsfg-mcp) | One-click MCP install | Developer API key |

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

bt = LetsFG(api_key="trav_...")
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

The MCP server connects to the letsfg.co server-side engine. Add `LETSFG_BEARER_TOKEN` (from `letsfg auth`) for free search, or `LETSFG_API_KEY` for the Developer API.

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
| `LETSFG_BEARER_TOKEN` | (none) | Bearer token from `letsfg auth` (free PFS search) |
| `LETSFG_API_KEY` | (none) | Developer API key for account, payment, unlock, and booking |
| `LETSFG_BASE_URL` | `https://letsfg.co/developers` | Override the website-owned public API base |

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
| `search_flights` | Search via the letsfg.co server-side engine |
| `get_agent_profile` | View account info and usage stats |
| `resolve_location` | Convert city names to IATA codes |
| `setup_payment` | Attach a Stripe payment method |
| `unlock_flight_offer` | Confirm price and reserve (payment required) |
| `book_flight` | Create airline booking after unlock |

[npm page →](https://www.npmjs.com/package/letsfg-mcp)

### Which MCP path should you use?

| Path | Search mode | Auth | Best for |
|------|-------------|------|----------|
| `npx letsfg-mcp` | Server-side at letsfg.co | Bearer token (`letsfg auth`) or Developer API key | Free search in Claude, Cursor, and Windsurf |
| `https://letsfg.co/developers/api/mcp` | Server-side at letsfg.co | Developer API key required | Account-managed search through the paid public API |

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
