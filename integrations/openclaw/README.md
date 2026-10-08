# LetsFG plugin for OpenClaw

Search and book real flights and hotels from inside [OpenClaw](https://openclaw.ai). Ask for the cheapest way to London next Friday, a round trip with open dates, where you could fly in Europe on a long weekend, or a hotel with breakfast near the old town. Then book it without leaving the chat.

[LetsFG](https://letsfg.co) searches every airline and the major travel sites in one go, checks every airport in a city, tests split tickets and prices the bags. A flight's details show its on-time record and how to get from the airport into the city. Then it books the flight or room for you on your LetsFG account.

This plugin connects OpenClaw to the hosted LetsFG MCP server (`letsfg`) at `https://letsfg.co/mcp`, over Streamable HTTP. It has no code of its own: the server's tools and instructions are the whole integration.

## Install

```bash
openclaw plugins install clawhub:@letsfg/letsfg
openclaw plugins enable letsfg
```

Later versions arrive with `openclaw plugins update letsfg`.

### Sign in (once)

LetsFG signs in with OAuth and Dynamic Client Registration. There is no API key, and nothing secret lives in this package. OpenClaw signs in only to servers saved in its own config, so save the `letsfg` server there once, then sign in:

```bash
openclaw mcp set letsfg '{"url":"https://letsfg.co/mcp","transport":"streamable-http","auth":"oauth","oauth":{"scope":"flights:search flights:book hotels:search hotels:book profile:read"}}'
openclaw mcp login letsfg
```

The config entry and the plugin's server share the name `letsfg`, and the config entry wins. After `mcp set` you can also sign in from **Settings → MCP → Sign in**.

Approve access on the letsfg.co page that opens. Choose **Connect as a guest** to start fresh, or **I've connected before** to sign in by e-mail and bring your saved card, travellers and preferences. No card is needed to sign in. Tokens refresh on their own.

## Try it

- "Find me the cheapest flight from Warsaw to London next Friday, back Sunday."
- "I have a week off in October. Where in Southern Europe can I fly from Berlin for a 4-night trip?"
- "Round trip Lisbon to New York, any 7 nights in November, cheapest dates."
- "A hotel in Paris for 12-14 November, two adults, breakfast included, under 400 EUR."
- "Book option A for me."
- "Never show me red-eye flights."

## What happens when you book

Booking is real. Before anything is held:

- **You choose.** LetsFG books only the offer you picked, at the price you saw.
- **You approve by e-mail.** Every booking starts only when you press the Approve button in an e-mail from LetsFG. The button works for 30 minutes. OpenClaw cannot start or approve a booking from the chat.
- **Your card stays out of the chat.** Payment details are only ever entered on letsfg.co. A booking that needs a card answers with a link to add one.

Then the price is **held** on your card, not taken. LetsFG buys the ticket from the seller and captures the hold only once the airline has issued a booking reference. If the booking fails, the hold is released. A flight booking takes 4 to 11 minutes, and OpenClaw relays the progress as it goes. Say "stop" while it runs and it stops, unless the seller has already been paid. A paid seat, an added bag or a changed price is approved the same way, from an e-mail.

Hotel bookings work the same way: the price is held and captured once the hotel confirms. A refundable booking can be cancelled until its free-cancellation date: ask in the chat, approve it from the e-mail, and 98% of what you paid comes back (a 2% fee covers payment costs that are not refundable).

The first booking for a new traveller needs the details an airline checkout asks for (name, date of birth, gender, nationality, contact, address, passport). They are saved on your LetsFG account, so next time a saved traveller is booked by name.

## Privacy and security

- Hosted-only connector: this folder is the whole plugin. It has no code, hooks or environment variables. Every tool call goes to `https://letsfg.co/mcp` over HTTPS.
- Access is scoped to the signed-in LetsFG account. Traveller details you give for a booking are stored on that account and used to book.
- Card details are never taken in the chat.
- Privacy policy: https://letsfg.co/en/privacy · Terms: https://letsfg.co/en/terms

## Troubleshooting

**No LetsFG tools in the session.** OpenClaw leaves a server out until it is signed in. Run the two sign-in commands above, then start a new session. `openclaw mcp probe letsfg` should list the tools.

**Tools fail with 401 or "unauthorized".** The sign-in lapsed. Run `openclaw mcp login letsfg` again.

**A booking asks for a card.** Open the `add_card_url` link it gives and add the card on letsfg.co, then ask OpenClaw to carry on.

## Other clients

The same server works in any MCP client: add `https://letsfg.co/mcp` as a remote (Streamable HTTP) server with OAuth. Setup for agents: https://letsfg.co/for-agents

## Support

- E-mail: contact@letsfg.co
- Issues: https://github.com/LetsFG/LetsFG/issues
- Website: https://letsfg.co

## License

This folder (plugin manifests and docs) is MIT licensed. The hosted LetsFG service and MCP server are separate and governed by the [LetsFG terms](https://letsfg.co/en/terms).
