# Remote MCP connector

LetsFG's hosted MCP server searches and books flights and hotels. It searches every airline in the world plus the major booking sites.

| | |
|---|---|
| **Endpoint** | `https://letsfg.co/developers/api/mcp` |
| **Transport** | Streamable HTTP (JSON-RPC 2.0 over `POST`) |
| **Auth** | OAuth 2.1, authorization code with PKCE |
| **Cost to connect** | Nothing. No sign-up form and no card. |

## Authentication

The user approves the connection once, in a browser: `letsfg.co/connect` opens and they tap **Approve**. No account, no plan, no card.

| | |
|---|---|
| **Flow** | Authorization code with PKCE. `S256` is required. |
| **Client registration** | Dynamic Client Registration (RFC 7591) is open, so no client ID has to be issued in advance. Public clients (`token_endpoint_auth_method: none`) and `client_secret_basic` are both accepted. |
| **Protected resource metadata** (RFC 9728) | `https://letsfg.co/developers/api/.well-known/oauth-protected-resource` |
| **Authorization server metadata** (RFC 8414) | `https://letsfg.co/developers/api/.well-known/oauth-authorization-server` |
| **Authorize** | `https://letsfg.co/connect` |
| **Token** | `https://letsfg.co/developers/api/oauth/token` |
| **Register** | `https://letsfg.co/developers/api/oauth/register` |
| **Scopes** | `flights:search` `flights:book` `hotels:search` `hotels:book` `profile:read` |
| **Access token** | Lasts 1 hour. Refresh it with the refresh token. |
| **Refresh token** | Doesn't expire. It rotates on every use, so store the new one. Reusing a refresh token after it has been rotated revokes the whole grant. |

A request without a token gets `401` with `WWW-Authenticate: Bearer resource_metadata="…"` pointing at the protected resource metadata. That's where a client starts discovery.

## Tools

### Flights

| Tool | What it does |
|---|---|
| `resolve_location` | Turns a city or airport name into IATA codes. |
| `search_flights` | Starts a flight search and returns a `search_id`. Nothing is held or paid. |
| `get_flight_results` | Returns the offers the search has found, ranked, with their offer ids. |
| `present_flight_options` | Shows the traveller up to three picked offers: recommended, most convenient and cheapest. |
| `get_flight_details` | Full details of one offer: each leg, flight numbers, aircraft, on-time record and whether the price is typical. |
| `book_flight` | Books an offer: holds the fare on the saved card, then a LetsFG booking agent buys the ticket. Returns a `booking_ref`. |
| `get_flight_booking` | Status of a booking: in progress, completed with the airline PNR, or failed. Also returns any question the booking is waiting on. |
| `answer_booking_question` | Sends the traveller's answer (a seat, an extra bag, a changed price) to a paused booking. |

### Hotels

| Tool | What it does |
|---|---|
| `resolve_hotel_city` | Picks the right city when a place name is ambiguous. |
| `search_hotels` | Starts a search for bookable hotel rates in a city and returns a `search_id`. |
| `get_hotel_results` | Returns the hotels once the search finishes, which takes about a minute. |
| `present_hotel_options` | Shows the traveller up to three picked hotels. |
| `get_hotel_details` | Full details of one hotel: rooms, rates, cancellation terms, amenities and location. |
| `book_hotel` | Books a room on the saved card and returns a `booking_job_id`. |
| `get_hotel_booking` | Status of a hotel booking, with the confirmation once it succeeds. |
| `cancel_hotel_booking` | Cancels a refundable booking before its free-cancellation deadline; 98% is refunded (2% cancellation fee). |

### Account and preferences

| Tool | What it does |
|---|---|
| `get_agent_profile` | Shows the account: payment status, usage and the travellers on file. |
| `edit_my_details` | Shows or changes saved traveller details (name, date of birth, passport) and contact details. |
| `change_payment_method` | Replaces or removes the saved card through a link e-mailed to the account holder. |
| `add_preference` | Saves a lasting travel preference, such as "aisle seat" or "no red-eyes". |
| `remove_preference` | Removes a saved preference. |
| `get_preferences` | Lists saved preferences. |

`tools/list` also includes `booking_setup` and `get_hotel_search_status`. They're marked `_meta.ui.visibility: ["app"]` because they drive the MCP Apps cards on hosts that draw them. A model never needs to call them.

## Limits

- **Flight searches:** 10 per 10 minutes, 30 per hour and 100 per day per user. They're counted per connected account, and per card once a card is added. Only starting a search counts. Reading results, details and booking status doesn't.
- **Over the limit:** searching pauses for 10 minutes. Repeat overruns pause it for longer, up to 24 hours.

## Booking and payment

- **Flights:** the card is asked for only at the first booking. `book_flight` returns an `add_card_url` where the traveller adds a card through Revolut, in a 0.00 setup with nothing charged. The same connection then books.
- **Hotels:** a card is needed before the first hotel search, because a hotel search opens a real session with the supplier.
- **Approval:** before any money is held, LetsFG e-mails the traveller an **Approve** button. Nothing is held until they press it.
- **The money:** the fare is held on the card, not taken. A LetsFG booking agent buys the ticket from the seller, and the hold is captured only once the airline issues a PNR. If the booking fails, the hold is released.
- **Timing:** bookings run in the background. Poll `get_flight_booking` until it reports `completed` or `failed`.
- **Traveller details:** each traveller's full name, date of birth, contact details and passport are required. Details are saved on the account, so they're asked for once.

## Try it

- **claude.ai / Claude Desktop:** Settings → Connectors → Add custom connector, URL `https://letsfg.co/developers/api/mcp`.
- **Claude Code:** `claude mcp add --transport http letsfg https://letsfg.co/developers/api/mcp`

See [Claude Desktop](quickstart-claude.md), [Cursor](quickstart-cursor.md) and [Windsurf](quickstart-windsurf.md) for client-specific steps.
