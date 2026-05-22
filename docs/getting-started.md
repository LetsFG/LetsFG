# Getting Started

<div class="docs-callout">
  <strong>Pick the correct path first.</strong> If you only want to run local connector search from the SDK or repo, stop after Option A. You do not need to create a paid public developer account just to search locally.
</div>

## Choose the right mode

| Mode | Best for | Setup | Search cost | Booking URL |
|------|----------|-------|-------------|-------------|
| Local search | SDK users, repo clones, connector debugging, wide local sweeps | Install only | Free | 1% concierge fee (min $3) via letsfg.co |
| letsfg.co (website / agent API) | Agents without local browsers, humans, zero-install | None | Free | 1% concierge fee (min $3) via letsfg.co |
| Public Developer API | Managed cloud search, products, teams, no per-booking fee | Register, attach Stripe, top up balance | Prepaid credits | Direct airline URLs, no fee |

## Option A: Free local search

### 1. Install

```bash
pip install letsfg
```

### 2. Run the first search

```bash
letsfg search LHR BCN 2026-06-15
```

That default CLI search runs connectors locally on your machine. No signup, no payment method, and no balance top-up are required.

### 3. Use Python local search when you need programmatic control

```python
from letsfg.local import search_local

result = await search_local("GDN", "BCN", "2026-06-15")
for offer in result.offers[:5]:
    print(f"{offer.airlines[0]}: {offer.currency} {offer.price}")
```

### 4. Optional fast mode

```bash
letsfg search LHR BCN 2026-06-15 --mode fast
```

Use `--mode fast` when you want a quicker local sweep across high-coverage OTAs and key airlines.

## Unlocking local search results (concierge flow)

Local search results (Path 1) return `offer_ref` and `payment_token` fields alongside each offer. The booking links in local results are masked by default. You have two options to get the direct airline URL:

**Option 1: Concierge unlock (1% fee, min $3.00)**

No API key required. Call the checkout endpoint with the offer details, pay via Stripe, then poll to receive the direct airline booking link.

```bash
# Step 1 — initiate checkout
curl -X POST https://letsfg.co/api/developers/checkout \
  -H "Content-Type: application/json" \
  -d '{
    "offer_id":      "off_xxx",
    "offer_ref":     "<offer_ref from search result>",
    "payment_token": "<payment_token from search result>",
    "currency":      "USD",
    "price":         "312.50"
  }'
# Returns: { "checkout_url": "https://checkout.stripe.com/...", "stripe_session_id": "..." }

# Step 2 — open checkout_url in a browser (human or agent presents it to the user)

# Step 3 — poll until paid (fee = max(price × 1%, $3.00))
curl "https://letsfg.co/api/developers/payment-verify?token=<payment_token>"
# Returns: { "verified": true, "booking_url": "https://airline.com/..." }
```

Keep polling `payment-verify` every few seconds until `verified` is `true`. The `booking_url` in the response is the direct airline link.

**Option 2: Developer API (no per-booking fee)**

Sign up at [letsfg.co/developers](https://letsfg.co/developers) for prepaid credits. Developer API searches return direct airline booking URLs with no concierge fee and no checkout step. See [Option B](#option-b-public-developer-api) below for setup.

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
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"payment_method_id": "pm_123"}'
```

If you have a browser available, you can also start hosted onboarding from the developers page or `POST /agents/hosted-checkout`.

### 3. Fund prepaid balance

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/top-up \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"amount_cents": 2500}'
```

Search is not enabled until balance exists. Top-up is the step that activates public flight search for that key.

### 4. Run the first public search

```bash
curl -X POST https://letsfg.co/developers/api/v1/flights/search \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"origin": "LHR", "destination": "JFK", "date_from": "2026-07-15", "adults": 1, "currency": "USD"}'
```

### 5. Inspect account status

```bash
curl https://letsfg.co/developers/api/v1/agents/me \
  -H "X-API-Key: trav_your_api_key"
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

## Search flags for local CLI mode

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
| `--mode` | `-m` | _(full)_ | `fast` reduces local search fan-out |
| `--max-browsers` | `-b` | _(auto)_ | Max concurrent browsers for local search |
| `--json` | `-j` | | Output raw JSON |

## Performance tuning for local mode

LetsFG auto-detects RAM and scales browser concurrency. Override only when you know the machine needs a smaller or larger local fan-out.

```bash
letsfg system-info

export LETSFG_MAX_BROWSERS=4
letsfg search LHR BCN 2026-06-15 --max-browsers 4
```
