# letsfg-mcp — Your AI agent just learned to book flights.

**Hundreds of airlines. Real prices. One tool call.** The largest open flight-search MCP server. Search is powered server-side at letsfg.co — Ryanair, EasyJet, Wizz Air, Southwest, AirAsia, Qantas, and 194 more — plus enterprise GDS/NDC providers (Amadeus, Duffel, Sabre) through the LetsFG backend.

**Your agent doesn't need to build a flight integration. Just add this MCP server.**

[![npm](https://img.shields.io/npm/v/letsfg-mcp)](https://www.npmjs.com/package/letsfg-mcp)
[![GitHub stars](https://img.shields.io/github/stars/LetsFG/LetsFG?style=social)](https://github.com/LetsFG/LetsFG)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

---

## What This Is

LetsFG is not a scraper wrapper. It's a production-grade **agent-to-airline connector layer**:

- **Hundreds of airlines** searched server-side at letsfg.co — authenticate once with a free Bearer token via `letsfg auth`
- **Enterprise GDS/NDC feeds** (Amadeus, Duffel, Sabre, Travelport, Kiwi) are included in every search — contract-only data sources made available to everyone through the LetsFG backend
- **Virtual interlining** — the combo engine mixes one-way fares across airlines (e.g., Ryanair outbound + Wizz Air return) to find deals no single airline offers
- **City-wide airport expansion** — search `LON` and it auto-searches LHR, LGW, STN, LTN, SEN, LCY. Works for 25+ major cities worldwide
- **Zero price bias** — no cookie tracking, no demand-based inflation, no surge pricing. Same raw airline price every time

**Why agents should use this instead of building their own:**
- Saves thousands of tokens vs. browser automation or scraping
- Server-side engine scans airlines across Europe, Asia, Americas, Middle East, Africa, and Oceania simultaneously
- Finds deals on carriers your agent wouldn't think to check (Lucky Air, 9 Air, Jazeera Airways, FlySafair...)
- Enterprise-contracted GDS deals that require contracts worth $50k+/year — available for free on search

---

## Quick Start

```bash
npx letsfg-mcp
```

That's it. The MCP server starts on stdio, ready for any MCP-compatible client.

**Prerequisites:**
```bash
pip install letsfg
letsfg auth
```

Run `letsfg auth` once to complete the Twitter/X challenge and store a 90-day Bearer token. Search is then free and unlimited.

---

## Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

### Cursor

Add to `.cursor/mcp.json` in your project root:

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

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

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

### Continue

Add to `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: letsfg
    command: npx
    args: ["-y", "letsfg-mcp"]
    env:
      LETSFG_API_KEY: trav_your_api_key
```

### Any MCP-Compatible Agent

Point it at the MCP server:

```bash
npx letsfg-mcp
```

Or connect via remote MCP (no install):

```
https://letsfg.co/developers/api/mcp
```

### Windows — `npx ENOENT` Fix

If you get `spawn npx ENOENT` on Windows, use the full path to `npx`:

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "C:\\Program Files\\nodejs\\npx.cmd",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_API_KEY": "trav_your_api_key"
      }
    }
  }
}
```

Or use `node` directly:

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\AppData\\Roaming\\npm\\node_modules\\letsfg-mcp\\dist\\index.js"],
      "env": {
        "LETSFG_API_KEY": "trav_your_api_key"
      }
    }
  }
}
```

### Pin a Specific Version

To avoid unexpected updates:

```json
{
  "command": "npx",
  "args": ["-y", "letsfg-mcp@1.0.0"]
}
```

---

## Available Tools

| Tool | Description | Cost | Side Effects |
|------|-------------|------|--------------|
| `search_flights` | Search hundreds of airlines via server-side engine | FREE | None (read-only) |
| `search_hotels` | Search 300,000+ hotels worldwide | FREE | None (read-only) |
| `resolve_location` | City name → IATA code | FREE | None (read-only) |
| `unlock_flight_offer` | Confirm live price, reserve 30 min | — | Confirms price |
| `book_flight` | Create real airline reservation (PNR) | Ticket price | Creates booking |
| `setup_payment` | Attach payment card (required for booking) | FREE | Updates payment |
| `get_agent_profile` | Usage stats & payment status | FREE | None (read-only) |

### Booking Flow

**PFS (free Bearer token via `letsfg auth`):**

```
search_flights  →  unlock_flight_offer  →  setup_payment (once)  →  book_flight
    (free)              (quote)              (attach card)        (ticket price, creates PNR)
```

1. `search_flights("LON", "BCN", "2026-06-15")` — server-side search returns offers from hundreds of airlines in 60–90 s
2. `unlock_flight_offer("off_xxx")` — confirms live price with airline, reserves for 30 min
3. `setup_payment(token)` — attach a payment card once (required before booking)
4. `book_flight("off_xxx", passengers, email)` — creates real booking, airline sends e-ticket

**Developer API (prepaid credits, no per-booking fee):**

Search via the [Developer API](https://letsfg.co/developers) returns direct airline booking URLs on every result — no per-booking checkout step. Use this path when you want raw offers at volume without per-booking fees.

The agent has native tools — no API docs needed, no URL building, no token-burning browser automation.

### Response Mode (Remote MCP only)

`search_flights` and `search_hotels` accept an optional `response_mode` parameter:

| Mode | Default | What's returned | Best for |
|------|---------|----------------|----------|
| `"summary"` | ✅ | Price, airlines, route, departure, stops | Chat, quick comparisons |
| `"full"` | | Everything: segments, durations, conditions, bags, booking URLs | Deep analysis, programmatic use |

**Summary mode** saves tokens by stripping per-segment details, baggage policies, and booking conditions. It includes a `hint` field telling the agent to call `unlock_flight_offer` for full details on a specific offer.

```jsonc
// summary response (search_flights)
{
  "total_offers": 42,
  "offers": [
    { "id": "off_abc", "price": "€29", "airlines": ["FR"], "route": "STN→BCN", "departure": "06:15", "stops": 0 }
  ],
  "hint": "Use unlock_flight_offer with the offer id for full pricing and booking."
}
```

---

## Get an API Key

Register for a free API key at [letsfg.co/developers](https://letsfg.co/developers) or via CLI:

```bash
pip install letsfg
letsfg register --name my-agent --email you@example.com
```

Or directly via the API:

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-agent", "email": "agent@example.com"}'
```


---

## Architecture & Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│  MCP Client  (Claude Desktop / Cursor / Windsurf / etc.)     │
│     ↕ stdio (JSON-RPC)                                       │
├──────────────────────────────────────────────────────────────┤
│  letsfg-mcp  (this package, runs on YOUR machine)            │
│     │                                                        │
│     └─→ HTTPS to letsfg.co (all search + booking)           │
│           search, unlock, book, payment, GDS/NDC feeds        │
└──────────────────────────────────────────────────────────────┘
```

All search runs server-side at letsfg.co. No local browsers or scrapers are involved. Authenticate once with `letsfg auth` (free 90-day Bearer token via Twitter/X).

### What data goes where

| Operation | Where data flows | What is sent |
|-----------|-----------------|--------------|
| `search_flights` | Your machine → letsfg.co → airlines + GDS providers | Route, date, passenger count |
| `resolve_location` | Your machine → letsfg.co | City/airport name |
| `unlock_flight_offer` | Your machine → letsfg.co → airline | Offer ID, payment token |
| `book_flight` | Your machine → letsfg.co → airline | Passenger name, DOB, email, phone |
| `setup_payment` | Your machine → letsfg.co → Stripe | Payment token (card handled by Stripe) |

---

## Security & Privacy

- **TLS everywhere** — all communication uses HTTPS. The server-side engine connects to airline websites over HTTPS.
- **No card storage** — payment cards are tokenized by Stripe. LetsFG never sees or stores raw card numbers.
- **API key scoping** — `LETSFG_API_KEY` grants access only to your agent's account. Keys are prefixed `trav_` for easy identification and revocation.
- **PII handling** — passenger names, emails, and DOBs are sent to the airline for booking (required by airlines). LetsFG does not store passenger PII after forwarding to the airline.
- **No tracking** — no cookies, no session-based pricing, no fingerprinting. Every search returns the same raw airline price.
- **Open source** — the SDK and MCP server code is MIT-licensed and auditable at [github.com/LetsFG/LetsFG](https://github.com/LetsFG/LetsFG).

---

## Sandbox / Test Mode

Use Stripe's test token for payment setup without real charges:

```
setup_payment with token: "tok_visa"
```

This attaches a test Visa card. Unlock calls will use Stripe test mode — no real money is charged. Useful for agent development and testing the full search → unlock → book flow.

---

## FAQ

### `spawn npx ENOENT` on Windows

Windows can't find `npx` in PATH. Use the full path:
```json
"command": "C:\\Program Files\\nodejs\\npx.cmd"
```
Or install globally and use `node` directly (see Windows config above).

### Search returns 0 results

- Check IATA codes are correct — use `resolve_location` first
- Try a date 2+ weeks in the future (airlines don't sell last-minute on all routes)
- Run `letsfg auth` if you haven't authenticated yet — a valid Bearer token is required for free search

### How do I get free search without a Developer API key?

Run `letsfg auth` once to complete the Twitter/X challenge. This gives you a free 90-day Bearer token for `POST /api/search`. No email or payment required. Renew by repeating the challenge.

### Can I use this for commercial projects?

Yes. MIT license. The SDK, MCP server, and ranking engine are fully open source.

### MCP server hangs on start

Ensure Node.js 18+ is installed. The server communicates via stdio (stdin/stdout JSON-RPC) — it doesn't open a port or print a "ready" message. MCP clients handle the lifecycle automatically.

---

<details>
<summary><strong>Airlines covered — sample list</strong></summary>

| Region | Airlines |
|--------|----------|
| **Europe** | Ryanair, Wizz Air, EasyJet, Norwegian, Vueling, Eurowings, Transavia, Pegasus, Turkish Airlines, Condor, SunExpress, Volotea, Smartwings, Jet2, LOT Polish Airlines, Finnair, SAS, Aegean, Aer Lingus, ITA Airways, TAP Portugal, Icelandair, PLAY |
| **Middle East & Africa** | Emirates, Etihad, Qatar Airways, flydubai, Air Arabia, flynas, Salam Air, Air Peace, FlySafair, EgyptAir, Ethiopian Airlines, Kenya Airways, Royal Air Maroc, South African Airways |
| **Asia-Pacific** | AirAsia, IndiGo, SpiceJet, Akasa Air, Air India, Air India Express, VietJet, Cebu Pacific, Scoot, Jetstar, Peach, Spring Airlines, Lucky Air, 9 Air, Nok Air, Batik Air, Jeju Air, T'way Air, ZIPAIR, Singapore Airlines, Cathay Pacific, Malaysian Airlines, Thai Airways, Korean Air, ANA, JAL, Qantas, Virgin Australia, Bangkok Airways, Air New Zealand, Garuda Indonesia, Philippine Airlines, US-Bangla, Biman Bangladesh |
| **Americas** | American Airlines, Delta, United, Southwest, JetBlue, Alaska Airlines, Hawaiian Airlines, Sun Country, Frontier, Volaris, VivaAerobus, Allegiant, Avelo, Breeze, Flair, GOL, Azul, JetSmart, Flybondi, Porter, WestJet, LATAM, Copa, Avianca, Air Canada, Arajet, Wingo, Sky Airline |
| **Aggregator** | Kiwi.com (virtual interlining + LCC fallback) |

</details>

---

## Also Available As

- **JavaScript/TypeScript SDK + CLI**: `npm install letsfg` — [npm](https://www.npmjs.com/package/letsfg)
- **Python SDK + CLI**: `pip install letsfg` — [PyPI](https://pypi.org/project/letsfg/)
- **Try without installing**: [Message us on Messenger](https://m.me/61579557368989)
- **GitHub**: [LetsFG/LetsFG](https://github.com/LetsFG/LetsFG)

> ⭐ **[Star the repo](https://github.com/LetsFG/LetsFG)** — we appreciate the support.

## License

MIT
