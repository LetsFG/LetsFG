# LetsFG for Cursor

Search and book flights and hotels from Cursor's chat.

This plugin connects Cursor to the LetsFG MCP server at `https://letsfg.co/mcp`.

## What it does

**Flights**
- Searches every airline in the world, low-cost carriers included, plus the major travel sites.
- Checks every airport in both cities, and split tickets when two one-ways beat a return.
- Shows bag prices, the airport transfer into the city, and each flight's on-time record.

**Hotels**
- Live rates with the total price, rooms, reviews and cancellation terms.

**Booking**
- Nothing is booked until you approve it on letsfg.co, from the review LetsFG shows in the chat (some bookings send an e-mail instead).
- Payment happens on letsfg.co, outside the editor. Cursor never sees your card details.
- Flights and hotels are separate bookings, not a package.

## Install

Install **LetsFG** from the Cursor plugin marketplace. The repository's root `.cursor-plugin/marketplace.json` points Cursor to this folder. The first time a LetsFG tool runs, Cursor opens letsfg.co to sign you in. That's a one-tap consent, and no card is needed to search.

### Manual setup

Add this to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "letsfg": {
      "type": "http",
      "url": "https://letsfg.co/mcp"
    }
  }
}
```

## Try it

- "Find me the cheapest way to fly from London to Milan next Friday. Check every airport, bags and the airport transfer."
- "Find a 4-star hotel in Paris for two nights in mid-December for 2 adults, with the total price and free cancellation."
- "Which of these flights is usually on time?"

## What's in this folder

| File | Purpose |
|---|---|
| `.cursor-plugin/plugin.json` | Plugin manifest |
| `mcp.json` | Remote MCP server (`https://letsfg.co/mcp`, OAuth sign-in) |
| `assets/logo.png` | Logo |

No keys or tokens are bundled. Sign-in uses OAuth 2.1 with PKCE against letsfg.co.

## Links

- Website: https://letsfg.co
- For AI agents: https://letsfg.co/for-agents
- Contact: contact@letsfg.co

## License

MIT
