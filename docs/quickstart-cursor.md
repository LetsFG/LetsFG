# Cursor — 5-Minute Quickstart

Choose between the paid remote MCP endpoint and the free local MCP server.

---

## Option A: Remote paid MCP

Use this when you want managed search through the public developer API at `letsfg.co/developers/api/mcp`.

### 1. Get an API key

```bash
curl -s -X POST https://letsfg.co/developers/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "cursor", "email": "you@example.com"}'
```

Public REST docs: [letsfg.co/developers/api/docs](https://letsfg.co/developers/api/docs)

### 2. Finish paid API onboarding

Remote search stays blocked until the account has a Stripe payment method and funded prepaid balance.

- Browserless/API-only path: [Onboarding and Billing](api-onboarding.md)
- Hosted browser path: [letsfg.co/en/developers](https://letsfg.co/en/developers)

### 3. Add to Cursor MCP config

Create `.cursor/mcp.json` in your project root (or global config):

```json
{
  "mcpServers": {
    "letsfg": {
      "url": "https://letsfg.co/developers/api/mcp",
      "headers": {
        "X-API-Key": "trav_your_key_here"
      }
    }
  }
}
```

### 4. Reload Cursor

Press `Ctrl+Shift+P` → `Developer: Reload Window`. LetsFG tools appear in the MCP panel.

### 5. Search

> Find me flights from Berlin to Lisbon on April 10

---

## Option B: Local MCP server

Use this when you want free local search inside Cursor.

### 1. Install local prerequisites

```bash
pip install letsfg
playwright install chromium
```

### 2. Add to `.cursor/mcp.json`

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"]
    }
  }
}
```

> **Windows `ENOENT` fix:** Replace `"npx"` with `"C:\\Program Files\\nodejs\\npx.cmd"`.

### 3. Reload Cursor

`Ctrl+Shift+P` → `Developer: Reload Window`

### 4. Search — that's it

> Find cheap flights from London to NYC next month.

No API key is required for local search. Cursor calls the local MCP server, which runs LetsFG search on your machine.

### 5. (Optional) Add API key for account-linked actions

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_API_KEY": "trav_your_key_here"
      }
    }
  }
}
```

Get a key: `curl -X POST https://letsfg.co/developers/api/v1/agents/register -H "Content-Type: application/json" -d '{"agent_name":"cursor","email":"you@example.com"}'`

---

## Use in Agent mode

Cursor's Agent mode can chain LetsFG tools automatically:

> "I need to fly from San Francisco to Tokyo next month. Find the cheapest option, show me the details, and walk me through booking."

The agent will:
1. `resolve_location("San Francisco")` → SFO
2. `search_flights("SFO", "TYO", "2026-05-01")`
3. Present options with prices
4. `unlock_flight_offer` when you confirm
5. `book_flight` with your details

## Troubleshooting

**"Connect a payment method and fund your prepaid API balance before searching"** -> your remote paid API account is not ready yet. Finish [Onboarding and Billing](api-onboarding.md) or use the hosted developers page.

**Tools not appearing** → Check `.cursor/mcp.json` is valid JSON. Reload window.

**"API key required"** → Verify `X-API-Key` header (remote) or `LETSFG_API_KEY` env (local)

**"Cannot start Python"** -> install the local prerequisites first: `pip install letsfg` and `playwright install chromium`

**Windows: `spawn npx ENOENT`** → Use full path: `"C:\\Program Files\\nodejs\\npx.cmd"`
