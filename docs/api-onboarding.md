# Onboarding and Billing

<div class="docs-callout">
  <strong>Two valid paths:</strong> use the browserless API-only flow when you already have a Stripe-generated <code>payment_method_id</code> or <code>token</code>, or use hosted checkout when a browser is available and you want LetsFG to handle the Stripe UI.
</div>

## Browserless onboarding (API only)

### 1. Register the developer account

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-agent", "email": "you@example.com", "owner_name": "My Team"}'
```

Typical response fields:

```json
{
  "agent_id": "ag_123",
  "api_key": "trav_abc123",
  "stripe_customer_id": "cus_123",
  "payment_ready": false,
  "tier": "developer"
}
```

### 2. Attach a Stripe payment method

The public proxy accepts only Stripe-generated `payment_method_id` or `token` values. Do not send raw card details.

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/setup-payment \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"payment_method_id": "pm_123"}'
```

You can also send a Stripe token:

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/setup-payment \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"token": "tok_visa"}'
```

### 3. Fund prepaid balance

Search stays blocked until balance exists. The current public minimum is `500` cents.

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/top-up \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"amount_cents": 2500, "auto_refill_enabled": true, "auto_refill_amount_cents": 2500}'
```

### 4. Confirm the account is ready

```bash
curl https://letsfg.co/developers/api/v1/agents/me \
  -H "X-API-Key: trav_your_api_key"
```

Check these fields before you search:

- `payment_ready`
- `access_granted`
- `developer_api.api_access_enabled`
- `developer_api.balance_cents`

## Hosted checkout flow

Use this path when you have a browser available and want LetsFG to create the Stripe session for you.

### Start hosted checkout

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/hosted-checkout \
  -H "Content-Type: application/json" \
  -d '{"success_url": "https://example.com/success", "cancel_url": "https://example.com/cancel"}'
```

### Complete hosted checkout

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/hosted-checkout/complete \
  -H "Content-Type: application/json" \
  -d '{"session_id": "cs_test_123", "api_key": "trav_your_api_key"}'
```

If you prefer the human UI, you can also go straight to [letsfg.co/en/developers](https://letsfg.co/en/developers).

## Ongoing billing operations

### Open the Stripe billing portal

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/billing-portal \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"return_url": "https://example.com/account"}'
```

### Update auto-refill settings

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/billing-settings \
  -H "X-API-Key: trav_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"auto_refill_enabled": true, "auto_refill_amount_cents": 2500}'
```

### Rotate the API key

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/rotate-key \
  -H "X-API-Key: trav_your_api_key"
```

Update every client after key rotation. Old keys should be treated as revoked immediately.

## What usually blocks search

| Symptom | Usual cause | Fix |
|---------|-------------|-----|
| `401 API key is required` | Missing or invalid key | Register first or rotate to a fresh key |
| `402 Connect a payment method and fund your prepaid API balance before searching` | Payment method missing, no balance, or exhausted balance | Call `setup-payment`, then `top-up` |
| `403 Fund your prepaid API balance before using flight search` | Account exists but paid search is not activated yet | Check `agents/me`, then top up balance |
| `400` on `setup-payment` | Browser fields or raw card details were sent | Send only `payment_method_id` or `token` |

Next: continue with [Search and Results](api-search.md).