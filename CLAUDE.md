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

# LetsFG — CLAUDE.md

> Instructions for Claude and other AI coding agents working on this repository.

---

## Programmatic Flight Pages — Feature Context

### Project Overview
LetsFG is a travel SaaS where AI agents act ON BEHALF of users to search all
available flight offers across every connector available in this repository.
Agents use open-source connectors (located in `/connectors/`) to query all
providers that sell flight tickets. The agent collects all offers, ranks them,
and returns results to the user.

### Critical Architecture Context
- Search results come from OUR AGENTS, not from direct GDS/API calls by the app
- Each agent search session may query dozens of connectors in parallel
- A single user session can yield 15–400+ deduplicated offers across all providers
- Connector output schemas are defined in `/connectors/` — always read the
  relevant connector source before writing any ingest or transformation code
- Users are NOT directly identified on public pages — agent sessions are
  anonymized before page data is written

### Tech Stack
- **Frontend:** Next.js 16 (App Router, standalone output), React 18, TypeScript strict
- **i18n:** next-intl 4.x (locale-based URL routing via `/website/app/[locale]/`)
- **Payments:** Stripe 22.x
- **Hosting:** Firebase (Firebase Hosting + Cloud Run via Docker)
- **Connectors:** Python 3 + Playwright + httpx + curl_cffi (180+ airline scrapers)
- **Testing:** Node.js native test runner (`tsx --test`) for unit/integration; Playwright for E2E
- **Icons:** FontAwesome 7, Lucide React

### Testing
- Node.js native test runner (`tsx --test`) for unit and integration tests
- Playwright for E2E
- Always write failing tests BEFORE implementation (TDD Red-Green-Refactor)
- Run `cd website && npm test` to verify before marking any task done
- Test files live in `/website/tests/`

### Code Style
- TypeScript strict mode; no `any` without justification
- `fetch` (native) for HTTP in website code — no axios
- Python connectors: `httpx` for async HTTP, `playwright` for browser automation
- File names: `kebab-case.ts` for lib utilities, `PascalCase.tsx` for React components
- Exports: named exports preferred over default exports in lib files

### Key Directories
```
/connectors/              ← open-source provider connectors (read source here first)
/website/app/[locale]/   ← Next.js App Router pages (locale-prefixed routes)
/website/lib/            ← shared utilities (analytics, cache, pricing, session)
/website/tests/          ← test files (tsx --test)
/website/app/api/        ← Next.js API routes
/growth-ops/             ← growth operations scripts and tooling
```

New Programmatic Flight Pages feature code goes in:
```
/website/app/[locale]/flights/   ← page templates (to be created in Session 4)
/website/lib/pfp/                ← PFP-specific lib (ingest, distribution, quality)
/website/tests/pfp/              ← PFP test files
```

### Non-negotiables
- All new features behind feature flags (see `/website/lib/flags.ts` — to be created in Session 6)
- All analytics via typed `trackEvent()` in `/website/lib/tracker.ts` — to be created in Session 6
- No direct `gtag()` or `analytics.track()` calls in feature code
- Every DB mutation creates an audit log entry

---

# LetsFG Codebase Context

> General platform context for AI agents working on this repository.

## Project Overview

LetsFG is an agent-native flight search & booking platform. This public repository contains the SDKs, 180+ local airline connectors, and documentation. The backend API runs on Cloud Run and is in a separate private repository.

**API Base URL:** `https://letsfg.co/developers/api/v1`

### Three access modes

| Mode | What it is | Speed | Cost |
|------|-----------|-------|------|
| **Local** (CLI / SDK / MCP-local) | 200+ connectors run on the user's machine via Playwright | 20–40 s (fast mode) · 1–15 min (full) | Free search; unlock 1% of ticket (min $3) |
| **PFS — Programmatic Flight Search** ([letsfg.co/for-agents](https://letsfg.co/for-agents)) | Server-side search via the letsfg.co engine; one-time Twitter/X challenge → 90-day Bearer token | 60–90 s | Free search; unlock 1% (min $3) |
| **Developer API** ([letsfg.co/developers](https://letsfg.co/developers)) | Server-side search with prepaid credits, no local browsers needed | 2–5 s (discover) · 60–90 s (full search) | Prepaid credits; direct booking URLs, no per-booking fee |

The local SDK is what this repository primarily contains. The Developer API, PFS, and website backend live in the private repository (`LetsFG-private`).

## Repository Structure

```
LetsFG/
├── sdk/
│   ├── python/                  # Python SDK → PyPI: letsfg
│   │   ├── letsfg/
│   │   │   ├── __init__.py          # Public exports, version
│   │   │   ├── client.py            # LetsFG main client class (urllib-based)
│   │   │   ├── cli.py               # CLI entry point (typer)
│   │   │   ├── local.py             # Local LCC search runner (no API key needed)
│   │   │   ├── system_info.py       # System resource detection (RAM, CPU, tier)
│   │   │   ├── models.py            # Re-exports from models/
│   │   │   ├── models/
│   │   │   │   ├── __init__.py
│   │   │   │   └── flights.py       # Pydantic models (FlightOffer, FlightSegment, etc.)
│   │   │   └── connectors/          # 180+ airline scrapers + infrastructure
│   │   │       ├── __init__.py
│   │   │       ├── _connector_template.py  # Reference template (3 patterns)
│   │   │       ├── browser.py        # Shared Chrome launcher, stealth CDP, cleanup
│   │   │       ├── engine.py         # Multi-provider search orchestrator
│   │   │       ├── combo_engine.py   # Virtual interlining (cross-airline combos)
│   │   │       ├── currency.py       # Currency conversion
│   │   │       ├── airline_routes.py # Route coverage registry (country → connectors)
│   │   │       ├── ryanair.py        # Direct API connectors...
│   │   │       ├── wizzair.py
│   │   │       ├── easyjet.py        # CDP Chrome connectors...
│   │   │       ├── norwegian.py      # Cookie-farm hybrid connectors...
│   │   │       └── [50 more airline connectors]
│   │   ├── pyproject.toml
│   │   └── README.md
│   ├── js/                      # JS/TS SDK → npm: letsfg
│   │   ├── src/
│   │   │   ├── index.ts             # Main client class
│   │   │   └── cli.ts               # CLI entry point
│   │   ├── package.json
│   │   └── README.md
│   └── mcp/                     # MCP Server → npm: letsfg-mcp
│       ├── src/
│       │   └── index.ts             # MCP tool definitions
│       ├── package.json
│       └── README.md
├── docs/                        # MkDocs documentation site
│   ├── index.md
│   ├── getting-started.md
│   ├── api-guide.md
│   ├── agent-guide.md
│   ├── cli-reference.md
│   └── packages.md
├── mcp-config.json              # Example MCP configuration
├── server.json                  # OpenAI plugin manifest
├── mkdocs.yml                   # MkDocs config
├── AGENTS.md                    # Agent-facing instructions
├── CLAUDE.md                    # This file
├── CONTRIBUTING.md              # Contribution guidelines
├── SECURITY.md                  # Security policy
├── SKILL.md                     # Machine-readable skill manifest
├── LICENSE                      # MIT
└── README.md                    # Public README
```

## Key Concepts

### Three-Step Flow
1. **Search** (free) → Returns flight offers from 180+ airlines (all local connectors)
2. **Unlock** (1% of ticket, min $3 — Stripe card or MPP crypto; free on the prepaid Developer API) → Confirms live price, reveals the direct booking URL
3. **Book** → Complete the booking on the airline's site via the returned booking URL

### Search Architecture
All search runs locally on the user's machine via 180+ airline connectors (Playwright + httpx). No cloud providers are used. The backend API handles only:
- Telemetry tracking (search stats, connector performance)
- Unlock (confirms live price with airline)
- Book (creates airline reservation)

### Fast Mode
The `--mode fast` flag (or `mode="fast"` in SDK) fires only ~25 high-coverage OTAs and key direct airlines instead of all 200+ connectors. Reduces search time from 6+ minutes to 20-40 seconds. The `_FAST_MODE_SOURCES` set is defined in `engine.py` and includes global OTAs (Kiwi, Skyscanner, Kayak, Momondo, etc.), regional OTAs for every continent, and key direct airlines (Ryanair, Wizz Air, Southwest, Allegiant). This only affects local search — the backend API is unchanged.

### 180+ local airline connectors
The `connectors/` directory contains scrapers for 180+ airlines. Three connector patterns:
- **Direct API** — Reverse-engineered REST/GraphQL endpoints (fastest, ~0.3-2s)
- **CDP Chrome** — Real Chrome browser via Playwright CDP for bot-protected sites (~10-25s)
- **API Interception** — Playwright navigation + response capture (~5-15s)

Key infrastructure files in `connectors/`:
- `browser.py` — Shared Chrome discovery, stealth launch (headless/CDP), adaptive concurrency, cleanup
- `engine.py` — Orchestrates all connectors in parallel, merges/deduplicates results
- `combo_engine.py` — Virtual interlining (cross-airline round-trips from one-way fares)
- `currency.py` — Real-time currency conversion for price normalization
- `airline_routes.py` — Maps countries to relevant connectors (only fires scrapers for relevant routes)

### Browser Concurrency Management
`browser.py` throttles concurrent Chrome instances with an `asyncio.Semaphore`. The limit is resolved in priority order:
1. `LETSFG_MAX_BROWSERS` env var (highest priority)
2. Explicit call to `configure_max_browsers(n)` or `--max-browsers` CLI flag
3. Auto-detect from available RAM via `system_info.py` (default)

`system_info.py` provides `get_system_profile()` which returns RAM, CPU, tier, and recommended max browsers. Tiers: minimal (<2GB, 2), low (2-4GB, 3), moderate (4-8GB, 5), standard (8-16GB, 8), high (16-32GB, 12), maximum (32+GB, 16).

### Zero Price Bias
The API returns raw airline prices — no demand-based inflation, no cookie tracking, no surge pricing. This is a core selling point.

### Free Search
Search is always free and unlimited (local connectors and PFS). Unlock reveals the direct booking URL for 1% of the ticket price (min $3); the prepaid Developer API returns direct booking URLs with no per-booking fee.

### Real Passenger Details Required
When booking, agents MUST use real passenger email and legal name. Airlines send e-tickets to the email provided. Placeholder/fake data will cause booking failures.

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

After editing JS or MCP source files, always rebuild with `npm run build` to update the dist bundles.

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
- Python SDK connectors use `playwright`, `httpx`, `curl_cffi`, `beautifulsoup4` for scraping.
- JS/TS SDK uses native `fetch`, TypeScript strict mode.
- MCP server uses `@modelcontextprotocol/sdk`.
- New connectors should follow one of the 3 patterns in `_connector_template.py`.
- After adding a connector, register it in `engine.py` and `airline_routes.py`.

## API Endpoints

Public developer onboarding and search docs are served from `https://letsfg.co/developers/api/docs` with base `https://letsfg.co/developers/api/v1`.

| Method | Path | Description | Billed? |
|--------|------|-------------|---------|
| `POST` | `/api/v1/agents/register` | Register for an API key | No |
| `POST` | `/api/v1/agents/setup-payment` | Attach Stripe payment method | No |
| `GET`  | `/api/v1/agents/me` | Agent profile, balance, and usage stats | No |
| `POST` | `/api/v1/agents/top-up` | Fund prepaid balance | No |
| `POST` | `/api/v1/agents/billing-settings` | Configure auto-refill | No |
| `POST` | `/api/v1/flights/parse-query` | Parse natural language query → IATA codes, dates, time prefs (Gemini) | **Free** |
| `POST` | `/api/v1/flights/discover` | Indicative prices for up to 20 destinations, sorted cheapest-first, 2–5 s | **1 credit** |
| `POST` | `/api/v1/flights/search` | Full 180+ connector search, single destination, 60–90 s | **1 credit** |
| `POST` | `/api/v1/flights/search/async` | Start full search in background, returns `search_id` immediately | **1 credit** |
| `GET`  | `/api/v1/flights/results/{id}` | Poll results of an async search | No |
| `POST` | `/api/v1/flights/multi-search` | Full search for N destinations in parallel (max 10) | **1 credit per destination** |
| `GET`  | `/api/v1/flights/locations/{q}` | Resolve city/airport name to IATA codes | No |
| `GET`  | `/api/v1/flights/providers` | List active flight providers | No |
| `POST` | `/api/v1/sandbox/flights/search` | Sandbox: fake data, same schema as /flights/search | **Free** |
| `POST` | `/api/v1/sandbox/flights/discover` | Sandbox: fake data, same schema as /flights/discover | **Free** |
| `POST` | `/api/v1/sandbox/flights/multi-search` | Sandbox: fake data, same schema as /flights/multi-search | **Free** |
| `POST` | `/api/v1/sandbox/flights/parse-query` | Sandbox: stub response, same schema as /flights/parse-query | **Free** |
| `GET`  | `/api/v1/sandbox/flights/locations/{q}` | Sandbox: stub location resolve | **Free** |
| `POST` | `/api/v1/bookings/unlock` | Unlock an offer (confirm live price) | No |
| `POST` | `/api/v1/bookings/book` | Book a flight (ticket price charged) | No |
| `GET`  | `/api/v1/bookings/booking/{id}` | Get booking details | No |
| `GET`  | `/.well-known/ai-plugin.json` | OpenAI Plugin manifest | No |
| `GET`  | `/.well-known/agent.json` | Agent Protocol manifest | No |
| `GET`  | `/llms.txt` | LLM instructions | No |
| `GET`  | `/openapi.json` | OpenAPI spec | No |
| `GET`  | `/mcp` | Remote MCP (Streamable HTTP) | No |

## Links

- **API Docs:** https://letsfg.co/developers/api/docs
- **PyPI:** https://pypi.org/project/letsfg/
- **npm SDK:** https://www.npmjs.com/package/letsfg
- **npm MCP:** https://www.npmjs.com/package/letsfg-mcp
- **GitHub:** https://github.com/LetsFG/LetsFG
