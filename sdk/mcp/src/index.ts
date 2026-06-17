#!/usr/bin/env node
/**
 * LetsFG MCP Server — Model Context Protocol integration.
 *
 * All search runs server-side at letsfg.co — no local browsers or Python required.
 * Authenticate once: `letsfg auth` (Twitter/X challenge) sets LETSFG_BEARER_TOKEN,
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
      headers: { 'User-Agent': `letsfg-mcp/${VERSION}` },
    });
    if (pollResp.ok) {
      const result = await pollResp.json() as Record<string, unknown>;
      if (result.status !== 'pending') return result;
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
  '## How It Works (3-Step Flow)\n' +
  '1. **search_flights** (FREE, unlimited) — Searches hundreds of airlines server-side. Returns prices, airlines, times, durations, stopovers. Requires Bearer token or API key.\n' +
  '2. **unlock_flight_offer** (1% fee, min $3) — Confirms live price with the airline. Reserves offer for 30 minutes. Charges via Stripe card or MPP crypto.\n' +
  '3. **book_flight** (ticket price only, Developer API only) — Creates real airline reservation with PNR. Charges ticket price via Stripe.\n' +
  '\n' +
  '## Authentication\n' +
  '- **PFS Bearer token** (free): Run `letsfg auth` to get a 90-day token via Twitter/X challenge. Set LETSFG_BEARER_TOKEN.\n' +
  '- **Developer API key** (prepaid credits): Register at letsfg.co/developers. Set LETSFG_API_KEY. Enables book_flight and no per-booking fee on unlock.\n' +
  '\n' +
  '## Pricing\n' +
  '- Search: FREE, unlimited\n' +
  '- Unlock: 1% of ticket price (min $3) — Stripe card or MPP crypto. Free with Developer API.\n' +
  '- Book: Exact airline price + Stripe processing fee. Zero markup. Developer API only.\n' +
  '\n' +
  '## Critical Rules\n' +
  '- **Resolve locations first**: City names are ambiguous. "London" = 5+ airports. Use resolve_location to get IATA codes before searching.\n' +
  '- **Real passenger details REQUIRED**: Airlines send e-tickets to the email provided. Names must match passport/government ID exactly. NEVER use placeholder emails, agent emails, or fake names.\n' +
  '- **Idempotency keys for booking**: Always provide idempotency_key when calling book_flight to prevent double-bookings on retry.\n' +
  '- **Price changes**: The unlock step confirms the real-time airline price, which may differ from search. Always inform the user if confirmed_price differs.\n' +
  '- **30-minute window**: After unlock, the offer is held for 30 minutes. If expired, search + unlock again.\n' +
  '\n' +
  '## Passenger ID Mapping\n' +
  'Search returns passenger_ids (e.g., ["pas_0", "pas_1"]). When booking, each passenger object must include the matching "id" field from this list.\n' +
  '\n' +
  '## Error Handling\n' +
  '- **transient** errors (SUPPLIER_TIMEOUT, RATE_LIMITED, SERVICE_UNAVAILABLE): Safe to retry after 1-5 seconds\n' +
  '- **validation** errors (INVALID_IATA, INVALID_DATE, MISSING_PARAMETER): Fix the input, then retry\n' +
  '- **business** errors (OFFER_EXPIRED, PAYMENT_DECLINED, OFFER_NOT_UNLOCKED): Requires human decision — do not auto-retry\n' +
  '\n' +
  '## Search Tips\n' +
  '- Search is free — search multiple dates, cabin classes, airport combos liberally\n' +
  '- Search takes 60-90s (async: POST /api/search -> poll /api/results/<id> every 10s)\n' +
  '- Filter search results (stops, duration, airline) before unlocking\n' +
  '- Covers hundreds of airlines across all continents including low-cost carriers\n';

const RESOURCES = [
  {
    uri: 'letsfg://guide',
    name: 'LetsFG Flight Search & Booking Guide',
    description: 'Complete workflow guide: 3-step booking flow, pricing, passenger rules, error handling, and search tips. Read this before using any tools.',
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
      'See letsfg://guide resource for the full search->unlock->book workflow.',
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
      'Confirm live price with the airline and reserve offer for 30 minutes (step 2 of 3).\n\n' +
      'Cost: 1% of ticket price (min $3) via Stripe card or MPP crypto. Free with Developer API.\n\n' +
      'This is the "quote" step — ALWAYS call before book_flight. The confirmed_price may differ from search price; ' +
      'if so, inform the user before proceeding.\n\n' +
      'Not idempotent — calling twice on the same offer may charge twice.',
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
      'Book an unlocked flight — creates real airline reservation with PNR (step 3 of 3). Developer API only.\n\n' +
      'FLOW: search_flights -> unlock_flight_offer -> setup_payment (once) -> book_flight\n' +
      'CHARGES: Ticket price via Stripe (2.9% + 30c processing). Zero markup.\n' +
      'SAFETY: Always provide idempotency_key to prevent double-bookings. Use REAL passenger details — ' +
      'names must match passport, email receives the e-ticket.\n\n' +
      'Errors include error_code/error_category: transient -> retry, validation -> fix input, business -> ask user.',
    inputSchema: {
      type: 'object',
      required: ['offer_id', 'passengers', 'contact_email'],
      properties: {
        offer_id: { type: 'string', description: "Unlocked offer ID (off_xxx)" },
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
    name: 'setup_payment',
    description: 'Attach a payment card (required before booking). Free to attach. Only needs to be called once.',
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
    description: 'Get agent profile, payment status, and usage stats. Read-only.',
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
      const path = BEARER_TOKEN ? '/api/unlock' : '/developers/api/v1/bookings/unlock';
      const result = await apiRequest('POST', path, { offer_id: args.offer_id });
      return JSON.stringify(result, null, 2);
    }

    case 'book_flight': {
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

    case 'setup_payment': {
      const body: Record<string, unknown> = {};
      if (args.token) body.token = args.token;
      if (args.payment_method_id) body.payment_method_id = args.payment_method_id;
      const result = await apiRequest('POST', '/developers/api/v1/agents/setup-payment', body);
      return JSON.stringify(result, null, 2);
    }

    case 'get_agent_profile': {
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
