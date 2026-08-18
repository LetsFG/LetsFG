#!/usr/bin/env node
/**
 * LetsFG MCP Server — Model Context Protocol integration.
 *
 * All search runs server-side at letsfg.co — no local browsers or Python required.
 * Authenticate once: `letsfg auth` (zero-amount card setup, nothing charged) sets
 * LETSFG_BEARER_TOKEN,
 * or use a Developer API key (LETSFG_API_KEY) for prepaid credits.
 *
 * Usage in Claude Desktop / Cursor config:
 * {
 *   "mcpServers": {
 *     "letsfg": {
 *       "command": "npx",
 *       "args": ["-y", "letsfg-mcp"],
 *       "env": {
 *         "LETSFG_BEARER_TOKEN": "eyJ..."
 *       }
 *     }
 *   }
 * }
 */

import * as readline from 'readline';

// ── Config ──────────────────────────────────────────────────────────────

const BASE_URL = (process.env.LETSFG_BASE_URL || 'https://letsfg.co').replace(/\/$/, '');
const BEARER_TOKEN = process.env.LETSFG_BEARER_TOKEN || '';
const API_KEY = process.env.LETSFG_API_KEY || '';
const VERSION = '1.3.0';

const PFS_POLL_INTERVAL_MS = 10_000;
const PFS_POLL_TIMEOUT_MS = 120_000;

// ── Cloud Search (PFS Bearer token path) ───────────────────────────────

async function searchPFS(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE_URL}/api/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BEARER_TOKEN}`,
      'User-Agent': `letsfg-mcp/${VERSION}`,
    },
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
    return { error: true, status_code: resp.status, detail: (data as Record<string, string>).detail || `HTTP ${resp.status}` };
  }

  const { search_id } = await resp.json() as { search_id: string };

  const deadline = Date.now() + PFS_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, PFS_POLL_INTERVAL_MS));
    const pollResp = await fetch(`${BASE_URL}/api/results/${search_id}`, {
      // Carry the token on the poll too, not just the POST: results are the
      // agent's own, and the token is what buckets rate limiting to this agent.
      headers: {
        'User-Agent': `letsfg-mcp/${VERSION}`,
        'Authorization': `Bearer ${BEARER_TOKEN}`,
      },
    });
    if (pollResp.ok) {
      const result = await pollResp.json() as Record<string, unknown>;
      if (!['pending', 'searching'].includes(result.status as string)) return result;  // API reports in-progress as 'searching'; only 'completed' (etc.) is terminal
    }
  }
  return { error: true, detail: 'Search timed out after 120s.' };
}

// ── API Client ──────────────────────────────────────────────────────────

async function apiRequest(method: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': `letsfg-mcp/${VERSION}`,
    'X-Client-Type': 'mcp',
  };

  if (BEARER_TOKEN) {
    headers['Authorization'] = `Bearer ${BEARER_TOKEN}`;
  } else if (API_KEY) {
    headers['X-API-Key'] = API_KEY;
  }

  const resp = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Parse defensively. This used to be a bare `await resp.json()`, which threw
  // on ANY non-JSON body and surfaced to the agent as
  // `Error: SyntaxError: Unexpected token '<', "<!DOCTYPE "...` — the real
  // status (404/502/a Cloudflare challenge page) was destroyed on the way out.
  // An agent cannot act on that; it can act on "status 404".
  const raw = await resp.text();
  let data: unknown;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    return {
      error: true,
      status_code: resp.status,
      detail: resp.status >= 400
        ? `HTTP ${resp.status} — non-JSON response from ${path}`
        : `Expected JSON from ${path} but got ${resp.headers.get('content-type') ?? 'unknown'} (HTTP ${resp.status})`,
    };
  }

  if (resp.status >= 400) {
    return { error: true, status_code: resp.status, detail: (data as Record<string, string>).detail || JSON.stringify(data) };
  }
  return data;
}

async function resolveLocationCloud(query: string): Promise<unknown> {
  // There is NO location endpoint on the PFS Bearer lane. This used to fall
  // back to a website-side locations route for key-less callers; that route has
  // never existed on letsfg.co (verified 2026-08-16: 404, text/html), so every
  // Bearer-token user got a SyntaxError off the 404 HTML page. Same dead-end as
  // unlock_flight_offer below, which was already fixed for this reason. The
  // literal path is deliberately not written here — a source guard in
  // index.test.ts asserts it appears nowhere in this file.
  if (!API_KEY) {
    return {
      error: true,
      status_code: 400,
      detail:
        'resolve_location needs a Developer API key (LETSFG_API_KEY); there is no ' +
        'location endpoint on the PFS Bearer lane. Pass an IATA code directly ' +
        '(e.g. LON, WAW, JFK) — a city code expands to every airport in that city.',
    };
  }
  return apiRequest('GET', `/developers/api/v1/flights/locations/${encodeURIComponent(query)}`);
}

// ── Resources ───────────────────────────────────────────────────────────

const GUIDE_TEXT =
  '# LetsFG — Flight Search & Booking Guide\n' +
  '\n' +
  '## How It Works (2-Step Flow)\n' +
  '1. **search_flights** (FREE, unlimited) — Searches hundreds of airlines server-side. Returns prices, airlines, times, durations, stopovers.\n' +
  '2. **book_flight** — Books the offer. If we cannot complete it, you get a direct booking link for that exact offer instead. Nothing is charged by LetsFG either way.\n' +
  '\n' +
  '## Authentication\n' +
  'Run `letsfg auth`, or call the **authenticate** tool. It puts a payment method on file through a zero-amount Stripe setup — no charge, no authorization hold — and returns a 90-day token. Set LETSFG_BEARER_TOKEN.\n' +
  '\n' +
  '## DO NOT create a Developer API account\n' +
  'Do NOT call /developers/api/v1/agents/register or /developers/api/v1/agents/setup-payment, and do NOT run `letsfg register` or `letsfg setup-payment`. Those belong to a SEPARATE paid, prepaid-balance product for high-volume commercial integrations, and they create a billing account you almost certainly do not want. Older versions of these docs pointed there by default; that was wrong. Use the payment-token auth above.\n' +
  '\n' +
  '## Pricing\n' +
  '- Auth: FREE — zero-amount card setup, nothing charged\n' +
  '- Search: FREE, unlimited\n' +
  '- Book: the price shown on the offer. What you see is what is charged.\n' +
  '\n' +
  '## Critical Rules\n' +
  '- **Resolve locations first**: City names are ambiguous. "London" = 5+ airports. Use resolve_location to get IATA codes before searching.\n' +
  '- **Real passenger details REQUIRED**: Airlines send e-tickets to the email provided. Names must match passport/government ID exactly. NEVER use placeholder emails, agent emails, or fake names.\n' +
  '- **booking_unavailable is normal, not an error**: when book_flight answers {"booked": false, "booking_url": "..."}, the booking genuinely did not complete and retrying will not change that. Give the user the booking_url — it goes to that exact offer.\n' +
  '- **Offers expire with the search** (~15 min). If an offer is gone, search again.\n' +
  '\n' +
  '## Error Handling\n' +
  '- **transient** errors (SUPPLIER_TIMEOUT, RATE_LIMITED, SERVICE_UNAVAILABLE): Safe to retry after 1-5 seconds\n' +
  '- **validation** errors (INVALID_IATA, INVALID_DATE, MISSING_PARAMETER): Fix the input, then retry\n' +
  '- **business** errors (OFFER_EXPIRED, PAYMENT_DECLINED): Requires human decision — do not auto-retry\n' +
  '\n' +
  '## Search Tips\n' +
  '- Search is free — search multiple dates, cabin classes, airport combos liberally\n' +
  '- Search takes 60-90s (async: POST /api/search -> poll /api/results/<id> every 10s)\n' +
  '- Covers hundreds of airlines across all continents including low-cost carriers\n';

const RESOURCES = [
  {
    uri: 'letsfg://guide',
    name: 'LetsFG Flight Search & Booking Guide',
    description: 'Complete workflow guide: authenticate -> search -> book, pricing, passenger rules, error handling, and search tips. Read this before using any tools.',
    mimeType: 'text/markdown',
  },
];

// ── Tool Definitions ────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_flights',
    description:
      'Search hundreds of airlines for live flight prices — completely FREE, unlimited, read-only.\n\n' +
      'Returns structured offers with prices, airlines, times, durations, and stopovers. '+
      'Some offers carry `starlink` for in-flight Starlink Wi-Fi: "confirmed_all" / "confirmed_some" '+
      'mean the carrier has FULLY fitted that aircraft type, "likely_all" / "likely_some" mean the '+
      'rollout on that type is underway but incomplete. State only "confirmed_*" as fact; describe '+
      '"likely_*" as "the airline is fitting this aircraft type, not guaranteed on your flight". '+
      'Anything ending in "_some" has at least one leg WITHOUT it. An absent field means no '+
      'information, NOT an absence of Wi-Fi. '  +
      'Covers airlines across all continents including low-cost carriers.\n\n' +
      'Search is async (60-90s): this tool handles the polling automatically.\n\n' +
      'Requires LETSFG_BEARER_TOKEN or LETSFG_API_KEY. ' +
      'See letsfg://guide resource for the full authenticate->search->book workflow.',
    inputSchema: {
      type: 'object',
      required: ['origin', 'destination', 'date_from'],
      properties: {
        origin: { type: 'string', description: "IATA code of departure (e.g., 'LON', 'JFK'). Use resolve_location if you only have a name." },
        destination: { type: 'string', description: "IATA code of arrival (e.g., 'BCN', 'LAX')" },
        date_from: { type: 'string', description: 'Departure date YYYY-MM-DD' },
        return_from: { type: 'string', description: 'Return date YYYY-MM-DD (omit for one-way)' },
        adults: { type: 'integer', description: 'Number of adults (default: 1)', default: 1 },
        children: { type: 'integer', description: 'Number of children (2-11)', default: 0 },
        cabin_class: { type: 'string', description: 'M=economy, W=premium, C=business, F=first', enum: ['M', 'W', 'C', 'F'] },
        currency: { type: 'string', description: 'Currency code (EUR, USD, GBP)', default: 'EUR' },
        max_results: { type: 'integer', description: 'Max offers to return', default: 10 },
        departure_time_from: { type: 'string', description: "Earliest departure time HH:MM (e.g., '06:00')" },
        departure_time_to: { type: 'string', description: "Latest departure time HH:MM (e.g., '14:00')" },
      },
    },
  },
  {
    name: 'resolve_location',
    description:
      'Convert a city/airport name to IATA codes. Always call before search_flights if you only have a city name. ' +
      'Read-only, safe to call multiple times.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: "City or airport name (e.g., 'London', 'Berlin')" },
      },
    },
  },
  {
    name: 'unlock_flight_offer',
    description:
      '[Developer API only] Confirm live price with the airline and reserve the offer for 30 minutes.\n\n' +
      'NOT part of the agent flow and NOT needed before book_flight. It requires LETSFG_API_KEY (the paid, ' +
      'prepaid Developer API) and refuses to run on a Bearer token, because the PFS unlock endpoint does not ' +
      'exist — calling it that way used to 404.\n\n' +
      'If you authenticated with `letsfg auth`, go straight from search_flights to book_flight.\n\n' +
      'Requires a Developer API key. Legacy path — not idempotent.',
    inputSchema: {
      type: 'object',
      required: ['offer_id'],
      properties: {
        offer_id: { type: 'string', description: "Offer ID from search results (off_xxx)" },
      },
    },
  },
  {
    name: 'book_flight',
    description:
      'Book a flight from a search result.\n\n' +
      'FLOW: authenticate (once) -> search_flights -> book_flight\n' +
      'CHARGES: nothing from LetsFG. A completed booking pays the airline prices from airlines and the major booking sites.\n' +
      'RESULT: either {"booked": true, "order_id": "..."} or {"booked": false, "booking_url": "..."} — ' +
      'the second means the booking genuinely did not complete and nothing was charged. That is a normal ' +
      'outcome, NOT a transient error: do not retry, give the user the booking_url.\n' +
      'SAFETY: use REAL passenger details — names must match passport, email receives the e-ticket.',
    inputSchema: {
      type: 'object',
      required: ['search_id', 'offer_id', 'passengers', 'contact_email'],
      properties: {
        search_id: { type: 'string', description: 'search_id from search_flights' },
        offer_id: { type: 'string', description: 'Offer ID from search_flights' },
        passengers: {
          type: 'array',
          description: "Passengers with 'id' from search passenger_ids",
          items: {
            type: 'object',
            required: ['id', 'given_name', 'family_name', 'born_on', 'email'],
            properties: {
              id: { type: 'string', description: 'Passenger ID from search (pas_xxx)' },
              given_name: { type: 'string', description: 'First name (passport)' },
              family_name: { type: 'string', description: 'Last name (passport)' },
              born_on: { type: 'string', description: 'DOB YYYY-MM-DD' },
              gender: { type: 'string', description: 'm or f', default: 'm' },
              title: { type: 'string', description: 'mr, ms, mrs, miss', default: 'mr' },
              email: { type: 'string', description: 'Email' },
              phone_number: { type: 'string', description: 'Phone with country code' },
            },
          },
        },
        contact_email: { type: 'string', description: 'Booking contact email' },
        idempotency_key: { type: 'string', description: 'Unique key to prevent double-bookings on retry (e.g., UUID). Strongly recommended.' },
      },
    },
  },
  {
    name: 'resolve_hotel_city',
    description:
      'Convert a place name to the supplier city id that search_hotels needs. Always call this first if you ' +
      'only have a city name. Read-only and safe to repeat.\n\n' +
      'Use `Id` from the first result as city_id and `Name` as city_name.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: "Place name (e.g., 'Warsaw', 'Paris')" },
      },
    },
  },
  {
    name: 'search_hotels',
    description:
      'Search real, bookable hotel inventory. Requires a payment method on file — the SAME card that ' +
      'authorises flight booking. That applies to search too, not just booking, because a search opens a ' +
      'real session at the supplier.\n\n' +
      'Only free-cancellation, pay-later rates are returned, so everything you see can actually be booked ' +
      'on these terms. The result set is smaller than a metasearch and that is deliberate.\n\n' +
      '`price` is what the guest pays. Keep `session_id` and the chosen offer\'s `combination_id_v2` — ' +
      'together they identify that exact rate, and book_hotel needs both. Takes up to a few minutes.',
    inputSchema: {
      type: 'object',
      required: ['city_id', 'city_name', 'check_in', 'check_out'],
      properties: {
        city_id: { type: 'number', description: 'From resolve_hotel_city (`Id`)' },
        city_name: { type: 'string', description: 'From resolve_hotel_city (`Name`)' },
        check_in: { type: 'string', description: 'yyyy-MM-dd' },
        check_out: { type: 'string', description: 'yyyy-MM-dd' },
        adults: { type: 'number', description: 'Adult guests (default 2)' },
        children: { type: 'number', description: 'Child guests (default 0)' },
        child_ages: { type: 'array', items: { type: 'number' }, description: 'Age of each child; the supplier needs these to price' },
        nationality: { type: 'string', description: 'Two-letter guest nationality. Rates and taxes genuinely differ by it.' },
        limit: { type: 'number', description: 'Max hotels to return (default 40)' },
      },
    },
  },
  {
    name: 'book_hotel',
    description:
      'Book one hotel rate. Charges 5% of the price to the card on file immediately as a NON-REFUNDABLE ' +
      'reservation fee; the balance is paid directly to the supplier through the pay link we return, by ' +
      'balance_due_by (the supplier\'s own auto-cancellation date).\n\n' +
      'Returns a booking_job_id, NOT the booking — a booking takes minutes. Poll get_hotel_booking until ' +
      'status is succeeded or failed.\n\n' +
      'The fee is charged BEFORE the room is committed, so a declined card costs nothing: no reservation ' +
      'exists and nothing is charged.\n\n' +
      'Send expected_price and expected_balance back exactly as search returned them. NOT idempotent — ' +
      'calling twice for the same rate books the room twice and charges two fees.',
    inputSchema: {
      type: 'object',
      required: ['session_id', 'hotel_code', 'combination_id_v2', 'expected_price',
                 'expected_balance', 'city_id', 'city_name', 'check_in', 'check_out',
                 'guests', 'email', 'phone'],
      properties: {
        session_id: { type: 'string', description: 'From search_hotels' },
        hotel_code: { type: 'number', description: 'From the chosen hotel' },
        combination_id_v2: { type: 'string', description: 'From the chosen offer — identifies that exact rate' },
        combination_id: { type: 'number', description: 'From the chosen offer (optional)' },
        expected_price: { type: 'number', description: "The offer's `price`, verbatim" },
        expected_balance: { type: 'number', description: "The offer's `balance_to_supplier`, verbatim" },
        hotel_name: { type: 'string' },
        city_id: { type: 'number' },
        city_name: { type: 'string' },
        check_in: { type: 'string', description: 'yyyy-MM-dd' },
        check_out: { type: 'string', description: 'yyyy-MM-dd' },
        adults: { type: 'number' },
        guests: {
          type: 'array',
          description: 'One entry per guest: {title, first_name, last_name}',
          items: {
            type: 'object',
            required: ['title', 'first_name', 'last_name'],
            properties: {
              title: { type: 'string', description: 'Mr / Mrs / Ms' },
              first_name: { type: 'string' },
              last_name: { type: 'string' },
            },
          },
        },
        email: { type: 'string', description: 'The voucher and pay link go here. A typo loses the booking.' },
        phone: { type: 'string' },
        phone_country_code: { type: 'string', description: "Default '48'" },
        special_requests: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'get_hotel_booking',
    description:
      'Collect the result of a booking started with book_hotel. Poll every ~20s.\n\n' +
      'status is in_progress, succeeded or failed. On success you get confirmation, ' +
      'reservation_fee_charged, pay_link, balance_due, balance_due_by and the full cancellation ladder. ' +
      'Read-only and safe to repeat.',
    inputSchema: {
      type: 'object',
      required: ['booking_job_id'],
      properties: {
        booking_job_id: { type: 'string', description: 'From book_hotel' },
      },
    },
  },
  {
    name: 'cancel_hotel_booking',
    description:
      'Release a hotel reservation. Free until balance_due_by; after that the hotel\'s own ladder applies ' +
      'and can reach 100%. The ladder is in the booking terms, so check the cost first.\n\n' +
      'The 5% reservation fee is NOT refunded. Takes over a minute; if it times out do NOT assume it ' +
      'failed — re-check before retrying.',
    inputSchema: {
      type: 'object',
      required: ['confirmation'],
      properties: {
        confirmation: { type: 'string', description: 'From the completed booking' },
      },
    },
  },
  {
    name: 'authenticate',
    description:
      'Get a LetsFG token by putting a payment method on file. Nothing is charged — ' +
      'a zero-amount Stripe setup, no charge and no authorization hold. Call once.\n\n' +
      'Call with no arguments to start: returns a setup_url for the user to add a card, plus a ' +
      'setup_session_id. Call again with that setup_session_id once they are done to receive the token. ' +
      'For a fully headless enrolment, mint a single-use card token against the LetsFG publishable ' +
      'key and pass card_token instead, skipping the browser entirely. payment_method_id is accepted ' +
      'ONLY for a card already enrolled through this flow — a bare pm_ id is not proof of card control.\n\n' +
      'This does NOT create a Developer API billing account. Do not use setup_payment for this.',
    inputSchema: {
      type: 'object',
      properties: {
        setup_session_id: { type: 'string', description: 'cs_... from a previous authenticate call, after the card was added' },
        payment_method_id: { type: 'string', description: 'Stripe pm_... for a card ALREADY enrolled through this flow (re-issue only)' },
        card_token: { type: 'string', description: 'Single-use Stripe tok_... minted against the LetsFG publishable key — the headless path' },
      },
    },
  },
  {
    name: 'setup_payment',
    description:
      '[Developer API only — you almost certainly want `authenticate` instead] Attaches a card to a ' +
      'PAID prepaid Developer API account. Refuses to run unless LETSFG_API_KEY is set, because agents ' +
      'kept calling this and creating billing accounts they did not need.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: "Payment token (e.g., 'tok_visa' for testing)" },
        payment_method_id: { type: 'string', description: 'Payment method ID (pm_xxx)' },
      },
    },
  },
  {
    name: 'get_agent_profile',
    description:
      '[Developer API only] Get agent profile, balance and usage stats. Read-only.\n\n' +
      'Requires LETSFG_API_KEY. A PFS Bearer token has no profile — it is bound to your payment ' +
      'method, carries no balance, and search and booking are free.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'load_resources',
    description:
      'Load the LetsFG workflow guide (3-step booking flow, pricing, passenger rules, error handling). ' +
      'Call this ONCE at the start of a conversation to understand how to use the flight tools correctly. ' +
      'Clients that support MCP resources get this automatically — this tool is for clients that do not.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Tool Handlers ───────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'search_flights': {
      if (!BEARER_TOKEN && !API_KEY) {
        return JSON.stringify({
          error: 'Authentication required. Set LETSFG_BEARER_TOKEN (from `letsfg auth`) or LETSFG_API_KEY.',
        });
      }

      const params: Record<string, unknown> = {
        origin: args.origin,
        destination: args.destination,
        date_from: args.date_from,
        adults: args.adults ?? 1,
        children: args.children ?? 0,
        currency: args.currency ?? 'EUR',
        limit: args.max_results ?? 10,
      };
      if (args.return_from) params.return_from = args.return_from;
      if (args.cabin_class) params.cabin_class = args.cabin_class;
      if (args.departure_time_from) params.departure_time_from = args.departure_time_from;
      if (args.departure_time_to) params.departure_time_to = args.departure_time_to;

      let result: Record<string, unknown>;
      if (BEARER_TOKEN) {
        result = await searchPFS(params);
      } else {
        result = await apiRequest('POST', '/developers/api/v1/flights/search', params) as Record<string, unknown>;
      }

      if (result.error) return JSON.stringify(result, null, 2);

      const offers = (result.offers || []) as Array<Record<string, unknown>>;
      const summary: Record<string, unknown> = {
        total_offers: offers.length,
        search_id: result.search_id,
        offers: offers.map(o => {
          const ob = o.outbound as Record<string, unknown> | undefined;
          const segs = (ob?.segments || []) as Array<Record<string, string>>;
          return {
            offer_id: o.id,
            price: `${o.price} ${o.currency}`,
            airlines: o.airlines,
            booking_url: o.booking_url,
            // Only present when there is something to say. Absent does NOT mean
            // the flight has no Wi-Fi -- see the tool description.
            ...(o.starlink ? { starlink: o.starlink } : {}),
            outbound: segs.length ? {
              from: segs[0].origin,
              to: segs[segs.length - 1].destination,
              departure: segs[0].departure,
              airline: segs[0].airline_name || segs[0].airline,
              stops: ob?.stopovers,
            } : null,
          };
        }),
      };
      return JSON.stringify(summary, null, 2);
    }

    case 'resolve_location': {
      const result = await resolveLocationCloud(args.query as string);
      return JSON.stringify(result, null, 2);
    }

    case 'unlock_flight_offer': {
      // There is no PFS unlock endpoint — /api/unlock 404s. Routing Bearer-token
      // callers there sent them into a dead end and told them it was a required
      // step. Refuse with a pointer instead of producing a 404 they have to
      // interpret.
      if (!API_KEY) {
        return JSON.stringify({
          error: 'wrong_tool',
          detail:
            'unlock_flight_offer belongs to the paid Developer API and needs LETSFG_API_KEY. ' +
            'On a PFS Bearer token there is no unlock step: call book_flight directly after ' +
            'search_flights. It returns either a confirmed order or a direct booking link.',
        }, null, 2);
      }
      const result = await apiRequest('POST', '/developers/api/v1/bookings/unlock', { offer_id: args.offer_id });
      return JSON.stringify(result, null, 2);
    }

    case 'book_flight': {
      // Bearer token → PFS booking. Only an explicit Developer API key routes to
      // the paid booking endpoint, so the default agent never touches it.
      if (BEARER_TOKEN) {
        const passengers = (args.passengers || []) as Array<Record<string, unknown>>;
        // /api/agent-book takes one passenger. Silently booking only the first
        // of several would hand back a confirmation for a trip nobody asked for,
        // so refuse instead of truncating.
        if (passengers.length > 1) {
          return JSON.stringify({
            error: 'multi_passenger_unsupported',
            detail:
              `Booking supports one passenger per call and ${passengers.length} were supplied. ` +
              'Nothing was booked. Book each passenger separately, or send the user to the ' +
              'booking_url from a single-passenger call.',
          }, null, 2);
        }
        const body: Record<string, unknown> = {
          search_id: args.search_id,
          offer_id: args.offer_id,
          contact_email: args.contact_email,
          passenger: passengers[0],
        };
        const result = await apiRequest('POST', '/api/agent-book', body) as Record<string, unknown>;
        return JSON.stringify(result, null, 2);
      }
      const body: Record<string, unknown> = {
        offer_id: args.offer_id,
        booking_type: 'flight',
        passengers: args.passengers,
        contact_email: args.contact_email,
      };
      if (args.idempotency_key) body.idempotency_key = args.idempotency_key;
      const result = await apiRequest('POST', '/developers/api/v1/bookings/book', body);
      return JSON.stringify(result, null, 2);
    }

    case 'resolve_hotel_city': {
      const result = await apiRequest('POST', '/developers/api/v1/hotels/destinations',
        { text: args.text as string });
      return JSON.stringify(result, null, 2);
    }

    case 'search_hotels': {
      const body: Record<string, unknown> = {
        city_id: args.city_id,
        city_name: args.city_name,
        check_in: args.check_in,
        check_out: args.check_out,
        adults: args.adults ?? 2,
        children: args.children ?? 0,
        nationality: args.nationality ?? 'PL',
        limit: args.limit ?? 40,
        with_images: false,
      };
      if (Array.isArray(args.child_ages) && args.child_ages.length) {
        body.child_ages = args.child_ages;
      }
      const result = await apiRequest('POST', '/developers/api/v1/hotels/search', body);
      return JSON.stringify(result, null, 2);
    }

    case 'book_hotel': {
      const body: Record<string, unknown> = {
        session_id: args.session_id,
        hotel_code: args.hotel_code,
        combination_id_v2: args.combination_id_v2,
        expected_price: args.expected_price,
        expected_balance: args.expected_balance,
        city_id: args.city_id,
        city_name: args.city_name,
        check_in: args.check_in,
        check_out: args.check_out,
        adults: args.adults ?? 2,
        guests: args.guests,
        email: args.email,
        phone: args.phone,
        phone_country_code: args.phone_country_code ?? '48',
        special_requests: args.special_requests ?? [],
      };
      if (args.combination_id != null) body.combination_id = args.combination_id;
      if (args.hotel_name) body.hotel_name = args.hotel_name;
      const result = await apiRequest('POST', '/developers/api/v1/hotels/book', body);
      return JSON.stringify(result, null, 2);
    }

    case 'get_hotel_booking': {
      const result = await apiRequest('GET',
        `/developers/api/v1/hotels/booking/${encodeURIComponent(args.booking_job_id as string)}`);
      return JSON.stringify(result, null, 2);
    }

    case 'cancel_hotel_booking': {
      const result = await apiRequest('POST', '/developers/api/v1/hotels/cancel',
        { confirmation: args.confirmation as string });
      return JSON.stringify(result, null, 2);
    }

    case 'authenticate': {
      if (args.setup_session_id || args.payment_method_id || args.card_token) {
        const body: Record<string, unknown> = {};
        if (args.setup_session_id) body.setup_session_id = args.setup_session_id;
        if (args.payment_method_id) body.payment_method_id = args.payment_method_id;
        if (args.card_token) body.card_token = args.card_token;
        const result = await apiRequest('POST', '/api/agent-access/verify', body) as Record<string, unknown>;
        if (!result.error && result.token) {
          return JSON.stringify({
            ...result,
            next: 'Set LETSFG_BEARER_TOKEN to this token and restart the MCP server.',
          }, null, 2);
        }
        return JSON.stringify(result, null, 2);
      }
      // apiRequest treats the 402 as an error envelope; call directly so the
      // agent sees setup_url, which is the whole point of the response.
      const resp = await fetch(`${BASE_URL}/api/agent-access/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `letsfg-mcp/${VERSION}` },
        body: '{}',
      });
      return JSON.stringify(await resp.json(), null, 2);
    }

    case 'setup_payment': {
      if (!API_KEY) {
        return JSON.stringify({
          error: 'wrong_tool',
          detail:
            'setup_payment attaches a card to a PAID Developer API account and is not how agents authenticate. ' +
            'Use the `authenticate` tool instead — nothing is charged and no billing account is created.',
        }, null, 2);
      }
      const body: Record<string, unknown> = {};
      if (args.token) body.token = args.token;
      if (args.payment_method_id) body.payment_method_id = args.payment_method_id;
      const result = await apiRequest('POST', '/developers/api/v1/agents/setup-payment', body);
      return JSON.stringify(result, null, 2);
    }

    case 'get_agent_profile': {
      // /agents/me is a Developer API concept (balance, usage, billing). A PFS
      // Bearer token has no profile there and used to get a bare 401, which reads
      // like a broken tool rather than "not applicable".
      if (!API_KEY) {
        return JSON.stringify({
          not_applicable: true,
          detail:
            'Agent profiles exist only on the paid Developer API (balance, usage, billing) and need ' +
            'LETSFG_API_KEY. A PFS Bearer token has no profile: it is bound to your payment method, ' +
            'carries no balance, and search and booking are free. Nothing to check.',
        }, null, 2);
      }
      const result = await apiRequest('GET', '/developers/api/v1/agents/me');
      return JSON.stringify(result, null, 2);
    }

    case 'load_resources': {
      return GUIDE_TEXT;
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ── MCP Protocol (stdio) ───────────────────────────────────────────────

function send(msg: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const method = msg.method as string;
  const id = msg.id;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'letsfg', version: VERSION },
        },
      });
      break;

    case 'notifications/initialized':
      break;

    case 'resources/list':
      send({ jsonrpc: '2.0', id, result: { resources: RESOURCES } });
      break;

    case 'resources/read': {
      const rParams = msg.params as Record<string, unknown>;
      const uri = rParams.uri as string;
      if (uri === 'letsfg://guide') {
        send({ jsonrpc: '2.0', id, result: { contents: [{ uri, mimeType: 'text/markdown', text: GUIDE_TEXT }] } });
      } else {
        send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown resource: ${uri}` } });
      }
      break;
    }

    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      break;

    case 'tools/call': {
      const params = msg.params as Record<string, unknown>;
      const toolName = params.name as string;
      const toolArgs = (params.arguments || {}) as Record<string, unknown>;

      try {
        const text = await callTool(toolName, toolArgs);
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${e}` }], isError: true } });
      }
      break;
    }

    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} });
      break;

    default:
      if (id) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
      }
  }
});

const authMode = BEARER_TOKEN ? 'PFS Bearer token' : API_KEY ? 'Developer API key' : 'NO AUTH (set LETSFG_BEARER_TOKEN or LETSFG_API_KEY)';
process.stderr.write(`LetsFG MCP v${VERSION} | auth: ${authMode}\n`);
