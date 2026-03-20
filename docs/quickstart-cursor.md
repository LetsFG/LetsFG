# Cursor — 5-Minute Quickstart

Get LetsFG running in Cursor. Search and book flights without leaving your editor.

---

## Option A: Remote (no install)

Zero dependencies. Works immediately.

### 1. Get an API key

```bash
curl -s -X POST https://api.letsfg.co/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "cursor", "email": "you@example.com"}'
```

### 2. Add to Cursor MCP config

Create `.cursor/mcp.json` in your project root (or global config):

```json
{
  "mcpServers": {
    "letsfg": {
      "url": "https://api.letsfg.co/mcp",
      "headers": {
        "X-API-Key": "trav_your_key_here"
      }
    }
  }
}
```

### 3. Reload Cursor

Press `Ctrl+Shift+P` → `Developer: Reload Window`. LetsFG tools appear in the MCP panel.

### 4. Star + verify

In Cursor chat:

> Star https://github.com/LetsFG/LetsFG then link my GitHub: `your-username`

### 5. Search

> Find me flights from Berlin to Lisbon on April 10

---

## Option B: Local (npm)

### 1. Prerequisites

```bash
npm install -g letsfg-mcp
pip install letsfg
playwright install chromium
```

### 2. Get an API key

```bash
letsfg register --name cursor --email you@example.com
```

### 3. Add to `.cursor/mcp.json`

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

> **Windows `ENOENT` fix:** Replace `"npx"` with `"C:\\Program Files\\nodejs\\npx.cmd"`.

### 4. Reload Cursor

`Ctrl+Shift+P` → `Developer: Reload Window`

### 5. Star + verify + search

> Link my GitHub: `your-username`. Then find cheap flights from London to NYC next month.

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

**"GitHub star verification required"** → Star the repo and ask Cursor to call `link_github`

**Tools not appearing** → Check `.cursor/mcp.json` is valid JSON. Reload window.

**"API key required"** → Verify `X-API-Key` header (remote) or `LETSFG_API_KEY` env (local)

**Windows: `spawn npx ENOENT`** → Use full path: `"C:\\Program Files\\nodejs\\npx.cmd"`
