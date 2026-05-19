# Public Developer API

<div class="docs-callout">
    <strong>Scope:</strong> this section is only about the website-owned public REST API at <code>https://letsfg.co/developers/api/v1</code>. Local SDK and CLI search still stay free and do not require the paid public onboarding flow.
</div>

## When to use this API

| If you need | Use |
|-------------|-----|
| Free connector search from the repo, CLI, or Python SDK | Local search |
| Managed cloud search, account billing, browserless onboarding, and a stable public contract | Public developer API |

## Canonical URLs

| Surface | URL |
|---------|-----|
| Public API root | [https://letsfg.co/developers/api](https://letsfg.co/developers/api) |
| Public REST base | `https://letsfg.co/developers/api/v1` |
| OpenAPI JSON | [https://letsfg.co/developers/api/openapi.json](https://letsfg.co/developers/api/openapi.json) |
| Swagger UI | [https://letsfg.co/developers/api/docs](https://letsfg.co/developers/api/docs) |
| Developers page | [https://letsfg.co/en/developers](https://letsfg.co/en/developers) |

## Public search lifecycle

<div class="docs-step-strip">
    <span class="docs-step">1. Register</span>
    <span class="docs-step-arrow">/</span>
    <span class="docs-step">2. Attach Stripe payment</span>
    <span class="docs-step-arrow">/</span>
    <span class="docs-step">3. Top up balance</span>
    <span class="docs-step-arrow">/</span>
    <span class="docs-step">4. Search</span>
    <span class="docs-step-arrow">/</span>
    <span class="docs-step">5. Check account state</span>
</div>

Public search is not anonymous. Requests stay blocked until the developer account has:

- an API key from `POST /agents/register`
- a Stripe payment method attached through `POST /agents/setup-payment` or hosted checkout
- prepaid balance funded through `POST /agents/top-up`

## What the public contract currently covers

The live public schema currently documents these groups of endpoints:

- account registration and hosted checkout
- Stripe payment attachment, billing portal, billing settings, and key rotation
- prepaid top-up and account inspection
- flight search, location resolution, and provider inspection

## Search activation checklist

Before you send paid search traffic, make sure `GET /agents/me` shows all of the following:

- `payment_ready: true`
- `access_granted: true`
- `developer_api.api_access_enabled: true`
- `developer_api.balance_cents` greater than `0`

## Read these pages in order

<div class="docs-resource-grid">
    <a class="docs-resource-card" href="api-onboarding/">
        <p class="docs-card-kicker">Step 1</p>
        <h3>Onboarding and billing</h3>
        <p>Register, attach Stripe, top up balance, open the billing portal, and rotate the key safely.</p>
    </a>

    <a class="docs-resource-card" href="api-search/">
        <p class="docs-card-kicker">Step 2</p>
        <h3>Search and results</h3>
        <p>Resolve locations, shape the search payload, inspect providers, and store the response fields that matter.</p>
    </a>

    <a class="docs-resource-card" href="api-errors/">
        <p class="docs-card-kicker">Step 3</p>
        <h3>Errors and limits</h3>
        <p>Map account state and request-body mistakes to the status codes your integration will actually see.</p>
    </a>

    <a class="docs-resource-card" href="openapi/">
        <p class="docs-card-kicker">Schema</p>
        <h3>OpenAPI and Swagger</h3>
        <p>Use the live website-owned schema instead of stale repository JSON or direct backend hosts.</p>
    </a>
</div>

## Minimal register-and-search example

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/register \
    -H "Content-Type: application/json" \
    -d '{"agent_name": "my-agent", "email": "you@example.com", "owner_name": "My Team"}'

curl -X POST https://letsfg.co/developers/api/v1/flights/search \
    -H "X-API-Key: trav_your_api_key" \
    -H "Content-Type: application/json" \
    -d '{"origin": "LHR", "destination": "JFK", "date_from": "2026-07-15", "adults": 1, "currency": "USD"}'
```

The second request succeeds only after payment is attached and prepaid balance has been funded.
