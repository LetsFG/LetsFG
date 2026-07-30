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

  const data = await resp.json();
  if (resp.status >= 400) {
    return { error: true, status_code: resp.status, detail: (data as Record<string, string>).detail || JSON.stringify(data) };
  }
  return data;
}

async function resolveLocationCloud(query: string): Promise<unknown> {
  const path = API_KEY
    ? `/developers/api/v1/flights/locations/${encodeURIComponent(query)}`
    : `/api/locations?q=${encodeURIComponent(query)}`;
  return apiRequest('GET', path);
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
  '- Book: Ticket price only, at the airline price. No LetsFG fee, no markup.\n' +
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
      'Returns structured offers with prices, airlines, times, durations, and stopovers. ' +
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
      'Cost when used with a Developer API key: 1% of ticket price (min $3). Not idempotent.',
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
      'CHARGES: nothing from LetsFG. A completed booking pays the airline price with zero markup.\n' +
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
