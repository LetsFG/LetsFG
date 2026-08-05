/**
 * Payment-token authentication for LetsFG Programmatic Flight Search (PFS).
 *
 * Nothing is charged to authenticate — it is a zero-amount Stripe setup that
 * validates and vaults a card, with no charge and no authorization hold.
 * Having a card on file is what lets an agent go all the way to booking.
 *
 * Flow (one-time):
 *   1. POST /api/agent-access/request  -> 402 { setup_url, setup_session_id }
 *   2. Present a payment method: a human opens setup_url and adds a card, or
 *      pass a payment_method_id / card_token you already hold
 *   3. POST /api/agent-access/verify   -> { token, expires_at } (90-day token)
 *
 * Mirrors sdk/python/letsfg/connectors/auth.py.
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';

const BASE_URL = process.env.LETSFG_BASE_URL || 'https://letsfg.co';
const TOKEN_TTL_MS = 90 * 24 * 3600 * 1000;

export class BearerTokenError extends Error {}

interface StoredConfig {
  pfs_auth?: { token: string; expires_at: number };
  [key: string]: unknown;
}

function configPath(): string {
  const base = platform() === 'win32' ? (process.env.APPDATA || homedir()) : homedir();
  return join(base, '.letsfg', 'config.json');
}

function loadConfig(): StoredConfig {
  const p = configPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg: StoredConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  try {
    chmodSync(p, 0o600);
  } catch {
    /* best effort — e.g. not supported on Windows */
  }
}

/** Return a valid Bearer token, or throw BearerTokenError. */
export function getBearerToken(): string {
  const env = process.env.LETSFG_BEARER_TOKEN;
  if (env) return env;

  const auth = loadConfig().pfs_auth;
  if (auth?.token && Date.now() < auth.expires_at - 3600_000) {
    return auth.token;
  }

  throw new BearerTokenError(
    'No valid LetsFG Bearer token.\n' +
    '  Run:  letsfg auth        (adds a payment method — nothing is charged)\n' +
    '  Or:   export LETSFG_BEARER_TOKEN=<token>'
  );
}

/** Save a Bearer token to ~/.letsfg/config.json. */
export function saveToken(token: string, expiresAt?: number): void {
  const cfg = loadConfig();
  cfg.pfs_auth = { token, expires_at: expiresAt ?? Date.now() + TOKEN_TTL_MS };
  saveConfig(cfg);
}

async function postJson(path: string, payload: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'LetsFG-js/0.1.0', 'X-Client-Type': 'js-sdk' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
  return { status: resp.status, data };
}

function parseExpiry(raw: unknown): number {
  if (typeof raw === 'number') return raw * 1000; // epoch seconds -> ms
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;
  }
  return Date.now() + TOKEN_TTL_MS;
}

/** Start enrolment. Returns the 402 body with setup_url / setup_session_id. */
export async function requestEnrolment(): Promise<Record<string, unknown>> {
  const { status, data } = await postJson('/api/agent-access/request', {});
  if (status !== 200 && status !== 402) {
    throw new BearerTokenError(`Could not start authentication (HTTP ${status}): ${data.error || ''}`);
  }
  return data;
}

/**
 * Exchange a payment method for a Bearer token. Saves and returns the token.
 * Pass exactly one of setupSessionId / paymentMethodId / cardToken.
 */
export async function verifyPaymentMethod(opts: {
  setupSessionId?: string;
  paymentMethodId?: string;
  cardToken?: string;
}): Promise<string> {
  const payload: Record<string, string> = {};
  if (opts.setupSessionId) payload.setup_session_id = opts.setupSessionId;
  else if (opts.paymentMethodId) payload.payment_method_id = opts.paymentMethodId;
  else if (opts.cardToken) payload.card_token = opts.cardToken;
  else throw new BearerTokenError('Provide one of setupSessionId, paymentMethodId, or cardToken.');

  const { status, data } = await postJson('/api/agent-access/verify', payload);
  if (status !== 200 || !data.token) {
    throw new BearerTokenError(`Verification failed (HTTP ${status}). ${data.hint || data.error || ''}`.trim());
  }
  const token = data.token as string;
  saveToken(token, parseExpiry(data.expires_at));
  return token;
}

function openBrowser(url: string): void {
  import('node:child_process').then(({ exec }) => {
    const cmd = platform() === 'win32' ? `start "" "${url}"` : platform() === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => { /* best effort, ignore failures */ });
  }).catch(() => { /* best effort */ });
}

/**
 * Interactive auth — call once to get a 90-day Bearer token. Opens Stripe's
 * hosted card page, waits for you to finish, then verifies. Nothing charged.
 */
export async function paymentAuth(openBrowserFlag = true): Promise<string> {
  console.log('\n  Connecting to LetsFG...');
  const data = await requestEnrolment();

  const setupUrl = data.setup_url as string | undefined;
  const sessionId = data.setup_session_id as string | undefined;
  if (!setupUrl || !sessionId) {
    throw new BearerTokenError('Server did not return a setup URL. Check https://letsfg.co/for-agents');
  }

  console.log('\n  LetsFG needs a payment method on file before it can search or book.');
  console.log('  Nothing is charged now — this is a zero-amount card setup.\n');
  console.log('  Step 1 — add a card here:\n');
  console.log(`     ${setupUrl}\n`);
  if (openBrowserFlag) openBrowser(setupUrl);
  console.log("  Step 2 — press Enter once you've finished.");
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('');
  rl.close();

  process.stdout.write('  Verifying... ');
  const token = await verifyPaymentMethod({ setupSessionId: sessionId });
  const expiresAt = loadConfig().pfs_auth?.expires_at ?? Date.now() + TOKEN_TTL_MS;
  console.log(`done. Token valid until ${new Date(expiresAt).toISOString().slice(0, 10)}.`);
  return token;
}
