# LetsFG plugin for Hermes Agent

![LetsFG](assets/banner.png)

Search and book real flights and hotels from inside [Hermes Agent](https://hermes-agent.nousresearch.com). Ask for the cheapest way to London next Friday, a round trip with open dates, where you could fly in Europe on a long weekend, or a hotel with breakfast near the old town. Then book it without leaving the chat.

[LetsFG](https://letsfg.co) searches every airline and the major travel sites in one go, checks every airport in a city, tests split tickets and prices the bags. A flight's details show its on-time record and how to get from the airport into the city. Then it books the flight or room for you on your LetsFG account.

One install ships:

- The hosted LetsFG MCP server (`letsfg`) at `https://letsfg.co/mcp`, over Streamable HTTP.
- `skills/letsfg/`, the workflow skill: how the search, shortlist and booking tools fit together, how to show LetsFG's result cards in a text chat, and the rules that keep a booking safe (book only what the traveller chose, one booking per trip, card details never in the chat).

## Install

```bash
hermes plugins install letsfg          # from the Hermes plugin catalog
hermes plugins enable letsfg
```

Later versions arrive with `hermes plugins update letsfg`.

### Sign in (once)

LetsFG signs in with OAuth 2.1 and Dynamic Client Registration. There is no API key, and nothing secret lives in this repository. The Agent Plugins v1 `mcp.json` format has no field for OAuth, so tell Hermes once that this server signs in with OAuth:

```bash
hermes mcp add letsfg --url https://letsfg.co/mcp --auth oauth --connect-timeout 300
```

Hermes prints a letsfg.co link (and opens it when it can): approve access there. Choose **Connect as a guest** to start fresh, or **I've connected before** to sign in by e-mail and bring your saved card, travellers and preferences. No card is needed to sign in. `--connect-timeout 300` gives you five minutes for that; without it, `hermes mcp add` gives up after 30 seconds, which is too short for the e-mail sign-in.

Hermes then lists the LetsFG tools and asks `Enable all N tools? [Y/n/select]`. `Y` is fine. Three of them (`booking_setup`, `get_flight_search_status`, `get_hotel_search_status`) exist only for LetsFG's in-app cards in clients such as claude.ai and ChatGPT, and the skill tells Hermes to leave them alone; to leave them out entirely, answer `select` and untick them.

Start a new Hermes session afterwards, or run `/reload-mcp` in an open one. Tokens are cached under `~/.hermes/mcp-tokens/` and refresh on their own. Your `config.yaml` entry and the plugin's `mcp.json` entry share the name `letsfg`, and the config entry wins; the plugin still supplies the skill. On a headless host, see Hermes' [OAuth over SSH guide](https://hermes-agent.nousresearch.com/docs/guides/oauth-over-ssh#mcp-servers).

## Try it

- "Find me the cheapest flight from Warsaw to London next Friday, back Sunday."
- "I have a week off in October. Where in Southern Europe can I fly from Berlin for a 4-night trip?"
- "Round trip Lisbon to New York, any 7 nights in November, cheapest dates."
- "A hotel in Paris for 12-14 November, two adults, breakfast included, under 400 EUR."
- "Two rooms in Rome for four adults, 3-6 December, near the Colosseum."
- "Book option A for me."
- "Never show me red-eye flights."

## What happens when you book

Booking is real. Before anything is held:

- **You choose.** The skill books only the offer you picked, at the price you saw.
- **You approve by e-mail.** Every booking starts only when you press the Approve button in an e-mail from LetsFG. The button works for 30 minutes. Hermes cannot start or approve a booking from the chat.
- **Your card stays out of the chat.** Payment details are only ever entered on letsfg.co. A booking that needs a card answers with a link to add one.

Then the price is **held** on your card, not taken. LetsFG buys the ticket from the seller and captures the hold only once the airline has issued a booking reference. If the booking fails, the hold is released. A flight booking takes 4 to 11 minutes, and Hermes relays the progress as it goes. Say "stop" while it runs and it stops, unless the seller has already been paid. A paid seat, an added bag or a changed price is approved the same way, from an e-mail.

Hotel bookings work the same way: the price is held and captured once the hotel confirms. A refundable booking can be cancelled until its free-cancellation date: ask in the chat, approve it from the e-mail, and 98% of what you paid comes back (a 2% fee covers payment costs that are not refundable).

The first booking for a new traveller needs the details an airline checkout asks for (name, date of birth, gender, nationality, contact, address, passport). Hermes asks you for them in the chat. They are saved on your LetsFG account, so next time a saved traveller is booked by name.

## Tools

Hermes exposes each tool as `mcp__letsfg__<tool>`. The server's own tool list is the source of truth; the main ones:

| Area | Tools | Access |
|---|---|---|
| Flights | `search_flights`, `search_flights_flexible_dates`, `get_flight_results`, `present_flight_options`, `get_flight_details`, `find_airports` | Read |
| Hotels | `search_hotels`, `get_hotel_results`, `present_hotel_options`, `get_hotel_details`, `resolve_hotel_city` | Read |
| Destinations | `explore_destinations`, `present_destinations` | Read |
| Flight booking | `book_flight`, `answer_booking_question`, `stop_flight_booking` | **Write** |
| Flight booking status | `get_flight_booking` | Read |
| Hotel booking | `book_hotel`, `cancel_hotel_booking` | **Write** |
| Hotel booking status | `get_hotel_booking` | Read |
| Account | `get_traveller_profile`, `get_preferences` | Read |
| Account | `edit_my_details`, `change_payment_method`, `add_preference`, `remove_preference` | **Write** |

Bookings, hotel cancellations, and changes to saved traveller details and to the payment method are approved from the account's e-mail, not the chat.

## Privacy and security

- Hosted-only connector: this folder is the whole plugin. It has no Python code, hooks or environment variables, and it does not update itself. Every tool call goes to `https://letsfg.co/mcp` over HTTPS.
- Access is scoped to the signed-in LetsFG account. Traveller details you give for a booking are stored on that account and used to book.
- Card details are never taken in the chat.
- Privacy policy: https://letsfg.co/en/privacy · Terms: https://letsfg.co/en/terms

## Troubleshooting

**No LetsFG tools in the session.** Run the sign-in command above, then start a new session. `hermes mcp test letsfg` should report the tools.

**`hermes mcp add` says "non-interactive environment".** It was run somewhere without a terminal (some desktop or agent-spawned shells). Answer `y` to save the config, then run `hermes mcp login letsfg`, which opens the sign-in anyway, and, if the entry was saved disabled, set `enabled: true` under `mcp_servers.letsfg` in `~/.hermes/config.yaml`.

**Tools fail with 401 or "unauthorized".** The sign-in lapsed. Run `hermes mcp login letsfg`, then start a new session.

**A booking asks for a card.** Open the `add_card_url` link it gives and add the card on letsfg.co, then ask Hermes to carry on.

## Other clients

The same server works in any MCP client: add `https://letsfg.co/mcp` as a remote (Streamable HTTP) server with OAuth. Setup for agents: https://letsfg.co/for-agents

## Support

- E-mail: contact@letsfg.co
- Website: https://letsfg.co

## License

This folder (plugin manifests, skill and docs) is MIT licensed. The hosted LetsFG service and MCP server are separate and governed by the [LetsFG terms](https://letsfg.co/en/terms).
