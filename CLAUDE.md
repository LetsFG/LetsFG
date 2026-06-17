# CLAUDE.md — 8-Rule Architecture
These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.
## Rule 1 — Think Before Coding
State assumptions explicitly. If uncertain, ask rather than guess.
Push back when a simpler approach exists. Stop when confused.
## Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
## Rule 3 — Surgical Changes
Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting. Match existing style.
## Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate independently.
## Rule 5 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh. Surface the breach.
## Rule 6 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
If unsure why code is structured a certain way, ask.
## Rule 7 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back. Stop and restate.
## Rule 8 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.

## Metrics source of truth
All metric / analytics / scoring work maps to the variables defined in
`growth-ops/src/models/growth-model.ts` (funnel L1–L7, quality Q1–Q3,
retention R1–R3, API A1–A3, OSS S1, viral V1–V2). Read that file first — the
growth model evolves regularly. Never invent a divergent metric list.

---

# LetsFG Codebase Context

> General platform context for AI agents working on this repository.

## Project Overview

LetsFG is an agent-native flight search & booking platform. This public repository
contains the Python SDK, JS/TS SDK, MCP server, and the open-source ranking engine.
The flight connectors and backend API run server-side at letsfg.co (private repo).

**PFS Base URL:** `https://letsfg.co` (Bearer token auth — see below)
**Developer API Base URL:** `https://letsfg.co/developers/api/v1`

### Access modes

| Mode | What it is | Speed | Cost |
|------|-----------|-------|------|
| **CLI / SDK** | `pip install letsfg` + `letsfg auth` — wraps PFS with auth and ranking | 60–90 s | Free search; unlock 1% of ticket (min $3) |
| **PFS — Programmatic Flight Search** | Direct Bearer token → `POST /api/search` → poll `/api/results/<id>` | 60–90 s | Free search; unlock 1% (min $3) |
| **Developer API** | Prepaid credits, no per-booking fee, 2–5 s discover endpoint | 2–5 s (discover) · 60–90 s (full search) | Prepaid credits |

Auth for CLI/PFS: one-time Twitter/X challenge (`letsfg auth`) → 90-day Bearer token.

## Repository Structure

```
LetsFG/
├── sdk/
│   ├── python/                  # Python SDK → PyPI: letsfg
│   │   ├── letsfg/
│   │   │   ├── __init__.py          # Public exports, version
│   │   │   ├── client.py            # LetsFG main client class (urllib-based)
│   │   │   ├── cli.py               # CLI entry point (typer)
│   │   │   ├── local.py             # Cloud search runner (calls PFS with Bearer token)
│   │   │   ├── models.py            # Re-exports from models/
│   │   │   ├── models/
│   │   │   │   ├── __init__.py
│   │   │   │   └── flights.py       # Pydantic models (FlightOffer, FlightSegment, etc.)
│   │   │   └── connectors/
│   │   │       ├── __init__.py
│   │   │       └── auth.py          # Twitter/X challenge auth flow
│   │   ├── pyproject.toml
│   │   └── README.md
│   ├── js/                      # JS/TS SDK → npm: letsfg
│   │   ├── src/
│   │   │   ├── index.ts             # Main client class
│   │   │   ├── ranking.ts           # Open-source ranking engine (rankOffers)
│   │   │   ├── offer-details.ts     # Offer amenity signal extractor
│   │   │   └── trip-purpose.ts      # TripPurpose type + normalization helpers
│   │   ├── package.json
│   │   └── README.md
│   └── mcp/                     # MCP Server → npm: letsfg-mcp
│       ├── src/
│       │   └── index.ts             # MCP tool definitions
│       ├── package.json
│       └── README.md
├── AGENTS.md                    # Agent-facing instructions
├── CLAUDE.md                    # This file
├── SKILL.md                     # Machine-readable skill manifest
├── LICENSE                      # MIT
└── README.md                    # Public README
```

## Key Concepts

### Three-Step Flow
1. **Search** (free) → `POST /api/search` with Bearer token → `search_id`; poll `GET /api/results/<search_id>` every 10 s
2. **Unlock** (1% of ticket, min $3; free on Developer API) → confirms live price, reveals booking URL
3. **Book** → complete booking on the airline's site via the returned URL

### Search Architecture
All flight data comes from the letsfg.co server-side engine. The SDK/CLI authenticates
via a 90-day Bearer token obtained through the Twitter/X challenge flow and calls the
cloud search API. No local browsers or scrapers are involved.

Auth flow (one-time):
```
POST /api/agent-access/request  → { challenge_code, tweet_text }
# post tweet_text from your Twitter/X account
POST /api/agent-access/verify   { challenge_code }  → { token, expires_at }
```

### Open-Source Ranking Engine
`sdk/js/src/ranking.ts` is the exact scoring algorithm used at letsfg.co to pick
the best flight from search results. It scores offers across 9 dimensions (price,
stops, duration, departure time, arrival time, baggage, savings vs Google Flights,
comfort hours, layover quality) with 12 weight profiles that shift by trip context
and purpose. Import directly or use via the `letsfg` npm package.

Companion modules in `sdk/js/src/`:
- `offer-details.ts` — extracts meal, Wi-Fi, refundability signals from fare text
- `trip-purpose.ts` — `TripPurpose` type and normalization helpers

### Zero Price Bias
The API returns raw prices with no demand-based inflation, cookie tracking, or surge
pricing. This is a core product principle.

### Free Search
Search via PFS is always free. Unlock costs 1% of the ticket (min $3 Stripe charge).
The prepaid Developer API returns direct booking URLs with no per-booking fee.

### Real Passenger Details Required
When booking, agents MUST provide real passenger email and legal name. Airlines send
e-tickets to the provided email. Placeholder data causes booking failures.

## SDK Development

### Python SDK
```bash
cd sdk/python
pip install -e ".[dev]"
python -m pytest
```

### JS/TS SDK
```bash
cd sdk/js
npm install
npm run build    # Compiles TypeScript → dist/
npm test
```

### MCP Server
```bash
cd sdk/mcp
npm install
npm run build    # Compiles TypeScript → dist/
```

After editing JS or MCP source files, always rebuild with `npm run build`.

## Publishing

### Python SDK → PyPI
```bash
cd sdk/python
python -m build
twine upload dist/*
```

### JS SDK → npm
```bash
cd sdk/js
npm run build
npm publish
```

### MCP Server → npm
```bash
cd sdk/mcp
npm run build
npm publish
```

## Conventions

- Keep SDK READMEs in sync with the root README for pricing, flow descriptions, and warnings.
- All agent-facing text should include the "zero price bias" messaging and passenger details warning.
- Python SDK client (`client.py`) uses stdlib `urllib` for HTTP — zero external dependencies.
- Python SDK auth uses stdlib `urllib` and `json` only (no playwright or scrapers).
- JS/TS SDK uses native `fetch`, TypeScript strict mode.
- MCP server uses `@modelcontextprotocol/sdk`.

## API Endpoints

### PFS (Bearer token, free)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agent-access/request` | Start Twitter/X challenge → `{ challenge_code, tweet_text }` |
| `POST` | `/api/agent-access/verify` | Verify challenge → `{ token, expires_at }` (90-day Bearer) |
| `POST` | `/api/search` | Start search → `{ search_id }` (Authorization: Bearer token) |
| `GET`  | `/api/results/<search_id>` | Poll results (no auth required) |
| `POST` | `/api/unlock` | Unlock offer → confirms live price + booking URL |

### Developer API (prepaid credits)
Base: `https://letsfg.co/developers/api/v1`

| Method | Path | Description | Billed? |
|--------|------|-------------|---------|
| `POST` | `/api/v1/agents/register` | Register for an API key | No |
| `POST` | `/api/v1/agents/setup-payment` | Attach Stripe payment method | No |
| `GET`  | `/api/v1/agents/me` | Agent profile, balance, and usage stats | No |
| `POST` | `/api/v1/agents/top-up` | Fund prepaid balance | No |
| `POST` | `/api/v1/flights/parse-query` | Parse natural language query → IATA codes, dates | **Free** |
| `POST` | `/api/v1/flights/discover` | Indicative prices for up to 20 destinations, 2–5 s | **1 credit** |
| `POST` | `/api/v1/flights/search` | Full search, single destination, 60–90 s | **1 credit** |
| `POST` | `/api/v1/flights/search/async` | Start full search async → `search_id` | **1 credit** |
| `GET`  | `/api/v1/flights/results/{id}` | Poll async search results | No |
| `POST` | `/api/v1/flights/multi-search` | Full search, N destinations (max 10) | **1 credit/dest** |
| `GET`  | `/api/v1/flights/locations/{q}` | Resolve city/airport name to IATA codes | No |
| `POST` | `/api/v1/bookings/unlock` | Unlock an offer | No |
| `POST` | `/api/v1/bookings/book` | Book a flight | No |
| `GET`  | `/api/v1/bookings/booking/{id}` | Get booking details | No |
| `GET`  | `/.well-known/ai-plugin.json` | OpenAI Plugin manifest | No |
| `GET`  | `/llms.txt` | LLM instructions | No |
| `GET`  | `/openapi.json` | OpenAPI spec | No |
| `GET`  | `/mcp` | Remote MCP (Streamable HTTP) | No |

## Links

- **API Docs:** https://letsfg.co/developers/api/docs
- **PyPI:** https://pypi.org/project/letsfg/
- **npm SDK:** https://www.npmjs.com/package/letsfg
- **npm MCP:** https://www.npmjs.com/package/letsfg-mcp
- **GitHub:** https://github.com/LetsFG/LetsFG
