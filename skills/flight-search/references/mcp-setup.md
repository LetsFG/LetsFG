# LetsFG MCP Server Setup

> ### ⚠️ Agents: do not create a Developer API account
>
> Do **NOT** call `/developers/api/v1/agents/register` or
> `/developers/api/v1/agents/setup-payment`, and do **NOT** run
> `letsfg register` or `letsfg setup-payment`. Those belong to a separate,
> paid, prepaid-balance product for high-volume commercial integrations and
> create a billing account you almost certainly do not want.
>
> To search and book flights, connect LetsFG as an MCP server at
> `https://letsfg.co/developers/api/mcp` and approve it — the consent step saves
> a card at <https://letsfg.co/connect> (nothing charged). Then search and book.
> See <https://letsfg.co/for-agents>.

Configure the LetsFG MCP server for your AI coding agent.

## Agents: connect, don't register

The way in is the remote server at `https://letsfg.co/developers/api/mcp`. Your
client runs OAuth; the consent step opens <https://letsfg.co/connect>, where the
person saves a card (any card, or Revolut Pay / Google Pay) in a 0.00 Revolut
setup — nothing is charged, no Revolut account needed. The token the client
receives is card-backed: it searches for free and it can book. Booking holds the
fare on that card, a LetsFG booking agent buys the ticket, and the hold is
captured only once a real airline PNR exists.

```bash
# Claude Code
claude mcp add --transport http letsfg https://letsfg.co/developers/api/mcp
```

claude.ai / ChatGPT: add a custom connector with that URL and approve it.
Cursor / Windsurf: see the remote config below, with no headers.

## Developer API key (paid product — only if you need it)

```bash
pip install letsfg
letsfg register --name my-agent --email you@example.com
# Save the trav_xxx key

# Attach a payment method (required before unlock)
letsfg setup-payment
```

Or via cURL:

```bash
curl -X POST https://letsfg.co/developers/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "my-agent", "email": "you@example.com"}'
```

## Remote MCP (Streamable HTTP) — No Install

Works with any client that supports HTTP-based MCP. Agents (PFS): no headers —
the client runs OAuth and the consent step saves the card at letsfg.co/connect.
Windsurf uses `"serverUrl"` instead of `"url"`.

```json
{
  "mcpServers": {
    "letsfg": { "url": "https://letsfg.co/developers/api/mcp" }
  }
}
```

Developer API accounts use the same URL with a key instead of OAuth:

```json
{
  "mcpServers": {
    "letsfg": {
      "url": "https://letsfg.co/developers/api/mcp",
      "headers": { "X-API-Key": "trav_your_api_key" }
    }
  }
}
```

## Local MCP (stdio) — Runs on Your Machine

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_API_KEY": "trav_your_api_key"
      }
    }
  }
}
```

## Client-Specific Setup

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "letsfg": {
      "url": "https://letsfg.co/developers/api/mcp",
      "headers": {
        "X-API-Key": "trav_your_api_key"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_API_KEY": "trav_your_api_key"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_API_KEY": "trav_your_api_key"
      }
    }
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "letsfg": {
      "command": "npx",
      "args": ["-y", "letsfg-mcp"],
      "env": {
        "LETSFG_API_KEY": "trav_your_api_key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add letsfg -- npx -y letsfg-mcp
```

Set the API key:

```bash
export LETSFG_API_KEY=trav_your_api_key
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `search_flights` | Search hundreds of airlines for flights via the LetsFG cloud engine |
| `resolve_location` | Convert city names to IATA codes |
| `book_flight` | Start a booking with one traveller's details. PFS: holds the fare on the connected card, returns a `booking_ref` in seconds |
| `get_flight_booking` | Poll a PFS booking every 20–30 s (4–11 min): `booking_in_progress` → `completed` (PNR) / `failed` (hold released) / `needs_attention` |
| `unlock_flight_offer` | **Developer API only** — confirm live price and reserve for 30 min |

## Verification

After setup, ask your agent: "Search for flights from London to Barcelona on June 15th 2026"

The agent should call `resolve_location` then `search_flights` and return structured results.
