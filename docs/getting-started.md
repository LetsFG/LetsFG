# Getting Started

> ### ⚠️ Agents: do not create a Developer API account
>
> Do **NOT** call `/developers/api/v1/agents/register` or
> `/developers/api/v1/agents/setup-payment`, and do **NOT** run
> `letsfg register` or `letsfg setup-payment`. Those belong to a separate,
> paid, prepaid-balance product for high-volume commercial integrations and
> create a billing account you almost certainly do not want.
>
> To search and book flights, connect LetsFG as an MCP server at
> <https://letsfg.co/developers/api/mcp>. The consent step opens
> <https://letsfg.co/connect>, where a card is saved (nothing is charged).
> See <https://letsfg.co/for-agents>.

<div class="docs-callout">
  <strong>Pick the correct path first.</strong> Use Option A (free Bearer token) if you want search with no credit card. Use Option B (Developer API) if you want direct airline booking URLs or managed billing.
</div>

## Choose the right mode

| Mode | Best for | Setup | Search cost | Booking |
|------|----------|-------|-------------|---------|
| MCP / SDK (card-backed token) | Agents, assistants, zero-cost search and booking | Connect the MCP at `letsfg.co/developers/api/mcp`; consent saves a card at `letsfg.co/connect` | Free | `book_flight` / `POST /api/agent-book` — fare held on the card, captured against a real PNR |
| Public Developer API | Managed cloud search, products, teams, no per-booking fee | Register, attach Stripe, top up balance | Prepaid credits | Direct airline URLs, no fee |
| Hotels | Booking a room, not a flight | Developer API key + card on file | Free search, card required | 5% at booking, balance via pay link |

**Hotels work on the same credential.** They accept either the card-backed PFS token or a
Developer API key, and need a card on file — which the connect step already saves. See
[Hotels](hotels.md).

## Option A: Free search and booking with a card-backed token

All search runs server-side at letsfg.co. No local browsers or Playwright required.

### 1. Connect once

Connect LetsFG as an MCP server at `https://letsfg.co/developers/api/mcp` and approve the connection. The consent step opens <https://letsfg.co/connect>, where you save a card in a 0.00 Revolut setup — any card, or Revolut Pay / Google Pay; no Revolut account needed, and the card details go to Revolut, never to LetsFG. Nothing is charged until you book, and even then the money is held, not taken, until the airline confirms.

That works in claude.ai, Claude Desktop, Claude Code (`claude mcp add --transport http letsfg https://letsfg.co/developers/api/mcp`), ChatGPT, Cursor, Windsurf — anything that speaks remote MCP with OAuth. Over the MCP the token is carried for you. Over raw HTTP send it as `Authorization: Bearer <token>`.

> `letsfg auth` (the old Stripe card setup) was retired on 2026-09-02 together with every token it issued. A connect-flow login for the CLI and SDKs is coming; until then the token comes from the MCP connection and the SDK/CLI read it from `LETSFG_BEARER_TOKEN` or `~/.letsfg/config.json`.

### 2. Search

> Find me the cheapest flight from London to Barcelona on June 15

Or from the CLI / SDK with the token in the environment:

```bash
pip install letsfg
export LETSFG_BEARER_TOKEN=eyJ...
letsfg search LHR BCN 2026-06-15
```

```python
from letsfg import LetsFG

bt = LetsFG()  # uses LETSFG_BEARER_TOKEN from environment
result = bt.search("GDN", "BCN", "2026-06-15")
for offer in result.offers[:5]:
    print(f"{offer.airlines[0]}: {offer.currency} {offer.price}")
```

Search is free: 10 per 10 minutes, 30 per hour, 100 per day per card. Polling results never counts.

### 3. Book

Booking works exactly like the website checkout, on the connected card. The fare plus LetsFG's markup is **held** (not taken), a LetsFG booking agent buys the ticket from the seller, and the hold is captured only once a real airline PNR exists. If the booking fails, the hold is released and nothing is charged. Every offer a search returns is bookable this way — there is no unlock step and no separate LetsFG fee.

Over the MCP: `book_flight` starts it and returns a `booking_ref` within seconds; poll `get_flight_booking` every 20–30 s. A booking takes 4–11 minutes.

Over HTTP, the same two calls:

```bash
# Step 1 — start (one traveller per call; real details, the e-ticket goes to contact_email)
curl -X POST https://letsfg.co/api/agent-book \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"search_id":"ws_abc123","offer_id":"ws_off_...",
       "contact_email":"traveller@example.com",
       "passenger":{"given_name":"Ada","family_name":"Lovelace","born_on":"1990-04-01",
                    "gender":"f","nationality":"GB","phone_number":"+15551234567",
                    "phone_country":"US","address_line1":"1 Analytical Way",
                    "address_city":"London","address_postal":"N1 9GU","address_country":"GB"}}'
# → {"booking_ref":"eyJ...","state":"booking_in_progress"}

# Step 2 — poll every 20-30 s
curl -X POST https://letsfg.co/api/agent-book/status \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"booking_ref":"eyJ..."}'
# → {"state":"completed","pnr":"ABC123","charged_amount":93,"currency":"EUR"}
```

`state` walks `booking_in_progress` → `completed` (PNR, captured amount) | `failed` (hold released, nothing charged, `failure_reason`) | `needs_attention` (a human at LetsFG is checking it — do not book again). A missing passenger field answers `missing_details` with `missing_fields` and charges nothing. Never start a second booking for the same trip while one is in progress.

Full contract: [Building AI Agents](agent-guide.md) and <https://letsfg.co/for-agents>.

---

## Option B: Public developer API

Use this path if you want account-managed cloud search through the website-owned developer API.

### 1. Register and keep the API key

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-agent", "email": "you@example.com"}'
```

Expected response fields include `agent_id`, `api_key`, and `payment_ready`.

### 2. Attach a Stripe payment method

For API-only onboarding, send a Stripe-generated `payment_method_id` or `token`.

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/setup-payment \
  -H "X-API-Key: letsfg_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"payment_method_id": "pm_123"}'
```

If you have a browser available, you can also start hosted onboarding from the developers page or `POST /agents/hosted-checkout`.

### 3. Fund prepaid balance

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/top-up \
  -H "X-API-Key: letsfg_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"amount_cents": 2500}'
```

Search is not enabled until balance exists. Top-up is the step that activates public flight search for that key.

### 4. Run the first public search

```bash
curl -X POST https://letsfg.co/developers/api/v1/flights/search \
  -H "X-API-Key: letsfg_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"origin": "LHR", "destination": "JFK", "date_from": "2026-07-15", "adults": 1, "currency": "USD"}'
```

### 5. Inspect account status

```bash
curl https://letsfg.co/developers/api/v1/agents/me \
  -H "X-API-Key: letsfg_your_api_key"
```

The profile response shows whether payment is ready, whether API access is enabled, and how much prepaid balance remains.

## Continue with the paid API docs

<div class="docs-resource-grid">
  <a class="docs-resource-card" href="api-guide/">
    <p class="docs-card-kicker">Overview</p>
    <h3>Public API overview</h3>
    <p>Get the canonical URLs, lifecycle, and the shortest path through the paid public API docs.</p>
  </a>

  <a class="docs-resource-card" href="api-onboarding/">
    <p class="docs-card-kicker">Billing</p>
    <h3>Onboarding and billing</h3>
    <p>Use the browserless setup-payment and top-up flow or the hosted checkout flow when a browser is available.</p>
  </a>

  <a class="docs-resource-card" href="api-search/">
    <p class="docs-card-kicker">Search</p>
    <h3>Search and results</h3>
    <p>See the request fields, location resolution endpoint, provider inspection endpoint, and example responses.</p>
  </a>

  <a class="docs-resource-card" href="api-errors/">
    <p class="docs-card-kicker">Ops</p>
    <h3>Errors and limits</h3>
    <p>Map account state, request limits, and retry behavior before sending paid traffic into production.</p>
  </a>
</div>

## Common mistakes

| Problem | What it means | What to do |
|---------|---------------|------------|
| `401 API key is required` | Search was attempted without `X-API-Key` | Register first and send the returned key |
| `402 Connect a payment method and fund your prepaid API balance before searching` | No payment method or no balance | Call `setup-payment`, then `top-up` |
| `403 Fund your prepaid API balance before using flight search` | The key exists but public search is not activated | Fund balance through `POST /agents/top-up` |
| `400` on `setup-payment` | Raw card data or browser checkout fields were sent | Send only Stripe-generated `payment_method_id` or `token` |

## Search flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--return` | `-r` | _(one-way)_ | Return date for round-trip (YYYY-MM-DD) |
| `--adults` | `-a` | `1` | Number of adult passengers (1-9) |
| `--children` | | `0` | Number of children (2-11 years) |
| `--cabin` | `-c` | _(any)_ | Cabin class filter |
| `--max-stops` | `-s` | `2` | Maximum stopovers per direction |
| `--currency` | | `EUR` | 3-letter currency code |
| `--limit` | `-l` | `20` | Maximum number of results |
| `--sort` | | `price` | Sort by `price` or `duration` |
| `--json` | `-j` | | Output raw JSON |
