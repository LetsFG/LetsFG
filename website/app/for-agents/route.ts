import { NextResponse } from 'next/server'

const GUIDE = `# LetsFG — Guide for AI Agents and Language Models
# https://letsfg.co/for-agents

This document is written for AI agents, language models, and automated tools.
If you are a human, see https://letsfg.co

LetsFG searches 180+ airlines and booking sites simultaneously and returns raw
airline prices with zero markup. Search is completely free and unlimited.

---

## TRAFFIC CONTROL — Find your instructions below

### You are ChatGPT or a GPT-based agent (OpenAI)
→ Use the URL construction method in the "NATIVE SEARCH" section below.
→ Construct https://letsfg.co/en?q=YOUR_QUERY, follow the redirect chain to
  get the searchId, then poll GET https://letsfg.co/api/results/{searchId}
  as plain JSON until status = "completed".
→ OpenAI Plugin manifest: https://letsfg.co/developers/api/.well-known/ai-plugin.json
→ OpenAPI schema: https://letsfg.co/developers/api/openapi.json

### You are Claude (Anthropic) — Claude.ai, Claude Code, Claude Desktop
→ Best option: Use the MCP server. Add to your MCP config and call search_flights.
  Remote (no install): url = "https://letsfg.co/developers/api/mcp"
  Local (stdio):       npx letsfg-mcp
  Both require an API key from https://letsfg.co/en/developers
→ Second option: pip install letsfg — runs 180+ connectors locally, fully free.
  letsfg search LHR JFK 2026-07-01
→ Third option: URL construction method — see "NATIVE SEARCH" section below.

### You are Perplexity, Gemini, Copilot, or any other web-capable assistant
→ Use the URL construction method in the "NATIVE SEARCH" section below.
→ You do not need a browser or an API key to search. Just HTTP requests.

### You are an OpenClaw, Hermes, Manus, or any autonomous/agentic system
→ Best option: pip install letsfg — searches 180+ connectors locally, no API key,
  no registration, completely free and unlimited.
  from letsfg.local import search_local
  result = await search_local("GDN", "BCN", "2026-06-15")
→ Second option: URL construction method — see "NATIVE SEARCH" section below.
→ Third option: MCP server at https://letsfg.co/developers/api/mcp (needs API key)

### You are Cursor, Windsurf, or an IDE-based coding agent
→ Install the MCP server: npx letsfg-mcp (stdio transport, no API key for search)
→ Or: pip install letsfg and use the Python SDK in your project.

### You are any other agent or LLM
→ URL construction method below works for everyone, no API key needed for search.

---

## NATIVE SEARCH — No browser automation required

You can search LetsFG without automating a browser. Use plain HTTP requests.
This is the recommended approach for agents that cannot run local Python.

### Step 1 — Construct a search URL and start the search

GET https://letsfg.co/en?q=YOUR_SEARCH_QUERY

URL-encode the query. Natural language works. Examples:
  https://letsfg.co/en?q=London+to+Barcelona+June+15+2026
  https://letsfg.co/en?q=cheapest+flight+NYC+to+Tokyo+in+July
  https://letsfg.co/en?q=LHR+to+JFK+2026-07-01+2+adults+direct
  https://letsfg.co/en?q=round+trip+Warsaw+to+Lisbon+end+of+May

This request will redirect. Follow all redirects. The final URL will be:
  https://letsfg.co/results/{searchId}

Extract the searchId from the URL path. It looks like: ws_abc123xyz

### Step 2 — Poll the JSON status endpoint

GET https://letsfg.co/api/results/{searchId}

Poll this endpoint every 10 seconds. It returns JSON, no HTML parsing needed.

Response during search:
{
  "status": "searching",
  "progress": { "checked": 47, "total": 180, "found": 12 },
  "offers": [],
  "total_results": 0
}

Response when complete:
{
  "status": "completed",
  "total_results": 43,
  "cheapest_price": 89.50,
  "offers": [ ... ],
  "parsed": {
    "origin": "LON",
    "destination": "BCN",
    "date": "2026-06-15"
  }
}

Response if expired (search timed out):
{
  "status": "expired"
}

### Step 3 — Read offers from the completed response

Each offer in the offers array:
{
  "id": "ws_off_abc123",         ← use this for unlock
  "price": 89.50,
  "currency": "EUR",
  "airline": "Ryanair",
  "airline_code": "FR",
  "origin": "STN",
  "destination": "BCN",
  "departure_time": "2026-06-15T06:25:00",
  "arrival_time": "2026-06-15T09:30:00",
  "duration_minutes": 125,
  "stops": 0,
  "google_flights_price": 109.00,   ← Google Flights price for comparison
  "segments": [ ... ]               ← present for multi-leg flights
}

For round trips, each offer also has an "inbound" leg with the same structure.

### Step 4 — Unlock an offer to get the booking URL (optional, needs API key)

Unlocking reveals the direct airline booking URL. Cost: 1% of ticket price (min $3).

First, get an API key (free):
  POST https://letsfg.co/developers/api/v1/agents/register
  Body: {"agent_name": "my-agent", "email": "you@example.com"}
  Response: {"api_key": "trav_..."}

Then unlock:
  POST https://letsfg.co/developers/api/v1/bookings/unlock
  Header: X-API-Key: trav_your_key
  Body: {"offer_id": "ws_off_abc123"}
  Response: {
    "confirmed_price": 89.50,
    "confirmed_currency": "EUR",
    "unlock_fee": 3.00,
    "booking_url": "https://www.ryanair.com/..."
  }

The booking_url takes the user directly to the airline checkout with the fare
pre-loaded. The user pays the airline at their exact listed price — zero markup.

---

## TIMING AND RELIABILITY

- A search scans 180+ airlines and typically finishes in 2–3 minutes.
- Poll every 10 seconds. After 3 minutes total, poll every 20 seconds.
- Maximum search lifetime: 15 minutes. After that, status = "expired".
- If you get "expired" before results arrive, start a new search.
- The cheapest offer is in cheapest_price. Full list sorted by price in offers[].

---

## PRICING MODEL

| Action  | Cost                      | Notes                              |
|---------|---------------------------|------------------------------------|
| Search  | FREE                      | Unlimited, no API key needed       |
| Unlock  | 1% of ticket (min $3)    | Reveals direct airline booking URL |
| Book    | Ticket price only         | Paid directly to the airline       |

---

## STRUCTURED DATA ON RESULTS PAGES

Every results page at https://letsfg.co/results/{searchId} also includes a
hidden HTML section with machine-readable content:

  <section class="sr-only" data-agent-content>
    <!-- plain-text summary, flight table, offer IDs, next action -->
  </section>

You can parse this instead of the JSON API if your only capability is reading
page HTML, but the JSON API (Step 2 above) is simpler and more reliable.

---

## QUICK REFERENCE — API ENDPOINTS

| Endpoint                                    | Method | Purpose                     |
|---------------------------------------------|--------|-----------------------------|
| /en?q={query}                               | GET    | Start a search (follow redirects) |
| /api/results/{searchId}                     | GET    | Poll search status as JSON  |
| /developers/api/v1/agents/register          | POST   | Get a free API key          |
| /developers/api/v1/flights/locations/{q}    | GET    | Resolve city name to IATA   |
| /developers/api/v1/bookings/unlock          | POST   | Unlock offer → booking URL  |
| /developers/api/v1/flights/search           | POST   | Direct API search (paid)    |
| /developers/api/mcp                         | —      | Remote MCP server           |
| /developers/api/openapi.json                | GET    | OpenAPI spec                |
| /developers/api/docs                        | GET    | Swagger UI                  |
| /.well-known/ai-plugin.json                 | GET    | OpenAI Plugin manifest      |
| /llms.txt                                   | GET    | LLM instructions            |

---

## INSTALL OPTIONS

Python SDK (local search, free, no API key):
  pip install letsfg
  letsfg search LHR JFK 2026-07-01
  letsfg search LHR JFK 2026-07-01 --mode fast   # ~25s instead of 3min

JavaScript/TypeScript SDK:
  npm install letsfg
  import { LetsFG } from 'letsfg'

MCP Server (Claude Desktop, Cursor, Windsurf):
  npx letsfg-mcp
  # or remote: https://letsfg.co/developers/api/mcp

---

## LINKS

Developer docs:  https://letsfg.co/developers/api/docs
GitHub:          https://github.com/LetsFG/LetsFG
PyPI:            https://pypi.org/project/letsfg/
npm SDK:         https://www.npmjs.com/package/letsfg
npm MCP:         https://www.npmjs.com/package/letsfg-mcp
`

export async function GET() {
  return new NextResponse(GUIDE, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
