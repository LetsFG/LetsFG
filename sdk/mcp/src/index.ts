#!/usr/bin/env node
/**
 * LetsFG MCP Server — Model Context Protocol integration.
 *
 * All search runs locally — spawns Python subprocess on your machine to run
 * 200 airline connectors. No backend calls for search or location resolution.
 * Requires: pip install letsfg && playwright install chromium
 *
 * Uses backend API only for unlock/book/payment operations (requires API key).
 *
 * Usage in Claude Desktop / Cursor config:
 * {
 *   "mcpServers": {
 *     "letsfg": {
 *       "command": "npx",
 *       "args": ["-y", "letsfg-mcp"],
 *       "env": {
 *         "LETSFG_API_KEY": "trav_your_api_key"
 *       }
 *     }
 *   }
 * }
 *
 * Rate limits: 10 searches/minute. The server returns rate limit info in results.
 */

import * as readline from 'readline';
import { spawn } from 'child_process';

// ── Config ──────────────────────────────────────────────────────────────

const BASE_URL = (process.env.LETSFG_BASE_URL || process.env.BOOSTEDTRAVEL_BASE_URL || 'https://api.letsfg.co').replace(/\/$/, '');
const API_KEY = process.env.LETSFG_API_KEY || process.env.BOOSTEDTRAVEL_API_KEY || '';
const PYTHON = process.env.LETSFG_PYTHON || process.env.BOOSTEDTRAVEL_PYTHON || 'python3';
const VERSION = '1.2.1';

// ── Local Python Search (runs on your machine, no backend) ──────────────

function searchLocal(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const input = JSON.stringify(params);
    // Try python3 first, fall back to python (Windows)
    const pythonCmd = process.platform === 'win32' ? 'python' : PYTHON;
    const child = spawn(pythonCmd, ['-m', 'letsfg.local'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180_000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (stderr) process.stderr.write(`[letsfg] ${stderr}\n`);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ error: `Python search failed (code ${code}): ${stdout || stderr}` });
      }
    });

    child.on('error', (err) => {
      resolve({
        error: `Cannot start Python. Install the letsfg package:\n` +
          `  pip install letsfg && playwright install chromium\n` +
          `Detail: ${err.message}`,
      });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

// ── Resources ───────────────────────────────────────────────────────────

const GUIDE_TEXT =
  '# LetsFG — Flight Search & Booking Guide\n' +
  '\n' +
  '## How It Works (3-Step Flow)\n' +
  '1. **search_flights** (FREE, unlimited) — Searches 200+ airline connectors locally on your machine. Returns prices, airlines, times, durations, stopovers. No API key needed.\n' +
  '2. **unlock_flight_offer** (FREE with GitHub star) — Confirms live price with the airline. Locks offer for 30 minutes. Call link_github first.\n' +
  '3. **book_flight** (ticket price only) — Creates real airline reservation. Charges ticket price via Stripe (2.9% + 30¢ processing). Zero markup.\n' +
  '\n' +
  '## Pricing\n' +
  '- Search: FREE, unlimited, no API key needed\n' +
  '- Unlock: FREE (requires GitHub star — call link_github once)\n' +
  '- Book: Exact airline price + Stripe processing fee. Zero markup.\n' +
  '- setup_payment: Attach card once before first booking\n' +
  '\n' +
  '## Critical Rules\n' +
  '- **Resolve locations first**: City names are ambiguous. "London" = 5+ airports. Use resolve_location to get IATA codes before searching.\n' +
  '- **Real passenger details REQUIRED**: Airlines send e-tickets to the email provided. Names must match passport/government ID exactly. NEVER use placeholder emails, agent emails, or fake names.\n' +
  '- **Idempotency keys for booking**: Always provide idempotency_key when calling book_flight to prevent double-bookings on retry. Use any unique string (e.g., UUID).\n' +
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
  '- Use mode="fast" for quick results (~25 connectors, 20-40s) vs full search (200+ connectors, 3-6 min)\n' +
  '- Multi-airport city expansion: searching one London airport auto-checks all 5\n' +
  '- Filter search results (stops, duration, airline) before unlocking\n' +
  '- Covers 180+ airlines across all continents including low-cost carriers most agents don\'t know\n' +
  '\n' +
  '## GitHub Star Verification\n' +
  '1. User stars https://github.com/LetsFG/LetsFG\n' +
  '2. Call link_github with their GitHub username\n' +
  '3. Once verified, all tools unlocked forever\n';

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
      'Search 200+ airline connectors for live flight prices. FREE, unlimited. ' +
      'Returns offers with prices, airlines, times, durations, stopovers. ' +
      'Read the letsfg://guide resource for full workflow details.',
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
        max_browsers: { type: 'integer', description: 'Max concurrent browser processes (1-32). Default: auto-detect from system RAM.' },
        mode: { type: 'string', description: "Omit for full search (200+ connectors). 'fast' = ~25 connectors, 20-40s.", enum: ['fast'] },
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
      'Confirm live price and reserve offer for 30 minutes (step 2 of 3). FREE with GitHub star. ' +
      'ALWAYS call before book_flight. Not idempotent.',
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
      'Book an unlocked flight — creates real airline reservation (step 3 of 3). Charges ticket price via Stripe. ' +
      'Always provide idempotency_key. Use REAL passenger details (name must match passport). ' +
      'See letsfg://guide for full flow and error handling.',
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
    name: 'start_checkout',
    description:
      'Automate airline checkout up to payment page (never submits payment). ' +
      'Supported: Ryanair, Wizz Air, EasyJet. Others return booking URL only. ' +
      'Requires checkout_token from unlock_flight_offer.',
    inputSchema: {
      type: 'object',
      required: ['offer_id', 'checkout_token'],
      properties: {
        offer_id: { type: 'string', description: 'Offer ID from search results (off_xxx)' },
        checkout_token: { type: 'string', description: 'Token from unlock_flight_offer response' },
        passengers: {
          type: 'array',
          description: 'Passenger details. If omitted, uses safe test data (John Doe, test@example.com)',
          items: {
            type: 'object',
            properties: {
              given_name: { type: 'string' },
              family_name: { type: 'string' },
              born_on: { type: 'string', description: 'DOB YYYY-MM-DD' },
              gender: { type: 'string', description: 'm or f' },
              title: { type: 'string', description: 'mr, ms, mrs' },
              email: { type: 'string' },
              phone_number: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'link_github',
    description:
      'Verify GitHub star for free unlimited access. User must star https://github.com/LetsFG/LetsFG first. ' +
      'Only needs to be called once.',
    inputSchema: {
      type: 'object',
      required: ['github_username'],
      properties: {
        github_username: { type: 'string', description: "User's GitHub username (e.g., 'octocat')" },
      },
    },
  },
  {
    name: 'system_info',
    description: 'Get system RAM, CPU cores, and recommended max_browsers for search_flights. Read-only, instant.',
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

// ── API Client ──────────────────────────────────────────────────────────

async function apiRequest(method: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': `letsfg-mcp/${VERSION}`,
    'X-Client-Type': 'mcp',
  };
  if (API_KEY) headers['X-API-Key'] = API_KEY;

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

// ── Tool Handlers ───────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'search_flights': {
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
      if (args.max_browsers) params.max_browsers = args.max_browsers;
      if (args.mode) params.mode = args.mode;

      // Always local — runs 200 connectors on user's machine, zero backend cost
      const result = await searchLocal(params) as Record<string, unknown>;

      if (result.error) return JSON.stringify(result, null, 2);

      const offers = (result.offers || []) as Array<Record<string, unknown>>;
      const rateLimitInfo = result.rate_limit as Record<string, unknown> | undefined;
      const summary: Record<string, unknown> = {
        total_offers: offers.length,
        source: 'local (200 airline connectors on your machine)',
        offers: offers.map(o => {
          // Handle both compact DM format and rich MCP format
          const hasRichFormat = o.outbound !== undefined;
          if (hasRichFormat) {
            // Rich format: {id, price (num), currency, airlines, outbound: {segments: [...]}, ...}
            const ob = o.outbound as Record<string, unknown> | undefined;
            const segs = (ob?.segments || []) as Array<Record<string, string>>;
            return {
              offer_id: o.id,
              price: `${o.price} ${o.currency}`,
              airlines: o.airlines,
              source: o.source,
              booking_url: o.booking_url,
              outbound: segs.length ? {
                from: segs[0].origin,
                to: segs[segs.length - 1].destination,
                departure: segs[0].departure,
                flight: segs[0].flight_no,
                airline: segs[0].airline_name || segs[0].airline,
                stops: ob?.stopovers,
              } : null,
            };
          }
          // Compact DM format: {price: "14.99 GBP", airlines, route, departure, arrival, duration, stops, book}
          return {
            price: o.price,
            airlines: o.airlines,
            route: o.route,
            departure: o.departure,
            arrival: o.arrival,
            duration: o.duration,
            stops: o.stops,
            booking_url: o.book || o.booking_url,
          };
        }),
      };
      if (rateLimitInfo) {
        summary.rate_limit = rateLimitInfo;
      }
      return JSON.stringify(summary, null, 2);
    }

    case 'resolve_location': {
      // Resolve locally via Python — no backend call
      const result = await searchLocal({ __resolve_location: true, query: args.query }) as Record<string, unknown>;
      return JSON.stringify(result, null, 2);
    }

    case 'unlock_flight_offer': {
      const result = await apiRequest('POST', '/api/v1/bookings/unlock', { offer_id: args.offer_id });
      return JSON.stringify(result, null, 2);
    }

    case 'link_github': {
      const result = await apiRequest('POST', '/api/v1/agents/link-github', { github_username: args.github_username as string });
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
      const result = await apiRequest('POST', '/api/v1/bookings/book', body);
      return JSON.stringify(result, null, 2);
    }

    case 'setup_payment': {
      const body: Record<string, unknown> = {};
      if (args.token) body.token = args.token;
      if (args.payment_method_id) body.payment_method_id = args.payment_method_id;
      const result = await apiRequest('POST', '/api/v1/agents/setup-payment', body);
      return JSON.stringify(result, null, 2);
    }

    case 'get_agent_profile': {
      const result = await apiRequest('GET', '/api/v1/agents/me');
      return JSON.stringify(result, null, 2);
    }

    case 'system_info': {
      const result = await searchLocal({ __system_info: true }) as Record<string, unknown>;
      return JSON.stringify(result, null, 2);
    }

    case 'start_checkout': {
      // Runs locally via Python — drives browser to payment page
      const result = await searchLocal({
        __checkout: true,
        offer_id: args.offer_id,
        passengers: args.passengers || null,
        checkout_token: args.checkout_token,
        api_key: API_KEY,
        base_url: BASE_URL,
      }) as Record<string, unknown>;

      if (result.error) return JSON.stringify(result, null, 2);

      const summary: Record<string, unknown> = {
        status: result.status,
        step: result.step,
        airline: result.airline,
        message: result.message,
        total_price: result.total_price ? `${result.total_price} ${result.currency}` : undefined,
        booking_url: result.booking_url,
        can_complete_manually: result.can_complete_manually,
        elapsed_seconds: result.elapsed_seconds,
      };
      if (result.screenshot_b64) {
        summary.screenshot = '(base64 screenshot attached — render with image tool if available)';
      }
      return JSON.stringify(summary, null, 2);
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

process.stderr.write(`LetsFG MCP v${VERSION} | search: local | rate limit: 10 req/min | api: ${API_KEY ? 'key set' : 'search-only (no key)'}\n`);
