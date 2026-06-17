# Claude Desktop — 5-Minute Quickstart

Choose between the paid remote MCP endpoint and the free local MCP server.

---

## Option A: Remote paid MCP

Use this when you want managed search through the public developer API at `letsfg.co/developers/api/mcp`.

### 1. Get an API key

Open any terminal:

```bash
curl -s -X POST https://letsfg.co/developers/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "claude-desktop", "email": "you@example.com"}'
```

Copy the `api_key` from the response (starts with `trav_`).

Public REST docs: [letsfg.co/developers/api/docs](https://letsfg.co/developers/api/docs)

### 2. Finish paid API onboarding

Remote search stays blocked until the account has a Stripe payment method and funded prepaid balance.

- Browserless/API-only path: [Onboarding and Billing](api-onboarding.md)
- Hosted browser path: [letsfg.co/en/developers](https://letsfg.co/en/developers)

### 3. Add to Claude Desktop config

Open `Settings → Developer → Edit Config` or edit the file directly:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

### 4. Restart Claude Desktop

Close and reopen Claude. You'll see LetsFG tools in the tool list.

### 5. Search

> Find me the cheapest flight from London to Barcelona next Friday

Remote MCP uses the paid public account you just configured.

---

## Option B: Local MCP server with free Bearer token

Use this when you want free search from Claude Desktop without a paid API account.

### 1. Install and authenticate

```bash
pip install letsfg
letsfg auth
```

`letsfg auth` walks you through the Twitter/X challenge and saves a 90-day Bearer token.

### 2. Add to Claude Desktop config

Open `Settings → Developer → Edit Config`:

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_BEARER_TOKEN": "your_bearer_token_here"
      }
    }
  }
}
```

> **Windows `ENOENT` fix:** Replace `"npx"` with `"C:\\Program Files\\nodejs\\npx.cmd"`.

### 3. Restart Claude Desktop

### 4. Search — that's it

> Find flights from London to Barcelona next Friday

The local MCP server sends search requests to the letsfg.co server-side engine using your Bearer token. No local browsers needed.

---

## What you can do

| Say this | What happens |
|----------|-------------|
| "Find flights from London to Barcelona next Friday" | `search_flights` → returns offers with prices |
| "What's the cheapest way to get from NYC to Tokyo?" | `resolve_location` → `search_flights` |
| "Book the Ryanair one for John Doe" | `unlock_flight_offer` → `book_flight` |
| "Search hotels in Barcelona for Apr 1-5" | `search_hotels` → returns rooms + prices |
| "Am I verified?" | `get_agent_profile` → shows star status |

## Troubleshooting

**"Connect a payment method and fund your prepaid API balance before searching"** -> your remote paid API account is not ready yet. Finish [Onboarding and Billing](api-onboarding.md) or use the hosted developers page.

**"API key required"** → Check your config has the `X-API-Key` header (remote) or `LETSFG_API_KEY` env (local)

**"Cannot start Python"** -> install the prerequisites first: `pip install letsfg` and `letsfg auth`

**No tools showing** → Restart Claude Desktop. Check the MCP icon in the bottom-left.

**Windows: `spawn npx ENOENT`** → Use full path: `"C:\\Program Files\\nodejs\\npx.cmd"`
