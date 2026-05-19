# Windsurf — 5-Minute Quickstart

Choose between the paid remote MCP endpoint and the free local MCP server.

---

## Option A: Remote paid MCP

Use this when you want managed search through the public developer API at `letsfg.co/developers/api/mcp`.

### 1. Get an API key

```bash
curl -s -X POST https://letsfg.co/developers/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "windsurf", "email": "you@example.com"}'
```

Public REST docs: [letsfg.co/developers/api/docs](https://letsfg.co/developers/api/docs)

### 2. Finish paid API onboarding

Remote search stays blocked until the account has a Stripe payment method and funded prepaid balance.

- Browserless/API-only path: [Onboarding and Billing](api-onboarding.md)
- Hosted browser path: [letsfg.co/en/developers](https://letsfg.co/en/developers)

### 3. Add to Windsurf MCP config

Edit `~/.codeium/windsurf/mcp_config.json`:

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

### 4. Restart Windsurf

Close and reopen Windsurf. LetsFG tools appear in the MCP panel.

### 5. Search

> Find the cheapest flight from Amsterdam to Rome this weekend

---

## Option B: Local MCP server

Use this when you want free local search from Cascade.

### 1. Install local prerequisites

```bash
pip install letsfg
playwright install chromium
```

### 2. Edit `~/.codeium/windsurf/mcp_config.json`

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

### 3. Restart Windsurf

### 4. Search — that's it

> Find flights from Paris to Barcelona for Easter.

No API key is required for local search. Windsurf calls the local MCP server, which runs LetsFG search on your machine.

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

Get a key: `curl -X POST https://letsfg.co/developers/api/v1/agents/register -H "Content-Type: application/json" -d '{"agent_name":"windsurf","email":"you@example.com"}'`

---

## Use in Cascade

Cascade can chain LetsFG tools in multi-step flows:

> "Plan a trip from London to Istanbul. Find flights for April 10-15 and hotels near Sultanahmet."

Cascade will:
1. `search_flights("LON", "IST", "2026-04-10", return: "2026-04-15")`
2. `search_hotels("Istanbul Sultanahmet", "2026-04-10", "2026-04-15")`
3. Present both results together

## Troubleshooting

**"Connect a payment method and fund your prepaid API balance before searching"** -> your remote paid API account is not ready yet. Finish [Onboarding and Billing](api-onboarding.md) or use the hosted developers page.

**Tools not appearing** → Check `mcp_config.json` path and JSON validity. Restart Windsurf.

**"API key required"** → Verify `X-API-Key` header (remote) or `LETSFG_API_KEY` env (local)

**"Cannot start Python"** -> install the local prerequisites first: `pip install letsfg` and `playwright install chromium`

**Windows: `spawn npx ENOENT`** → Use full path: `"C:\\Program Files\\nodejs\\npx.cmd"`
