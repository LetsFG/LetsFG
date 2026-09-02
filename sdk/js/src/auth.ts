/**
 * Authentication for LetsFG Programmatic Flight Search (PFS).
 *
 * Nothing is charged to connect: it is a 0.00 Revolut setup that saves the card
 * for a merchant-initiated charge, so the agent can BOOK later. You pay the
 * ticket price only when you book, and the money is HELD, not taken, until the
 * airline confirms.
 *
 * This is the SAME card lane the hosted connectors (Claude, ChatGPT, Grok) use.
 * A CLI is not a second-class client: the OAuth metadata advertises
 * authorization_endpoint = https://letsfg.co/connect and /oauth/register is open
 * dynamic registration (RFC 7591), so this package registers itself and drives
 * that screen directly.
 *
 * Flow (one-time, standard OAuth + PKCE):
 *   1. GET  /developers/api/.well-known/oauth-authorization-server   (discovery)
 *   2. POST /developers/api/oauth/register  with a loopback redirect_uri
 *   3. open authorization_endpoint (/connect) -> a person adds a card
 *   4. POST /developers/api/oauth/token      code -> access + refresh token
 *
 * RETIRED 2026-09-02: the Stripe lanes (setup_url, setup_intent_id,
 * payment_method_id, card_token) and every token they issued. There is no
 * endpoint that mints a token from card details; a human approves once.
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const BASE_URL = process.env.LETSFG_BASE_URL || 'https://letsfg.co';
const DEV_ROOT = `${BASE_URL}/developers/api`;
/** Access tokens are short (about an hour) and refreshed, not re-consented. */
const FALLBACK_TTL_MS = 55 * 60 * 1000;
/** Refresh a little early so a call never races the expiry. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export class BearerTokenError extends Error {}

interface PfsAuth {
  token: string;
  expires_at: number;
  refresh_token?: string;
  client_id?: string;
}
interface StoredConfig {
  pfs_auth?: PfsAuth;
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
    /* best effort - not supported everywhere */
  }
}

/** Save a Bearer token to ~/.letsfg/config.json. */
export function saveToken(token: string, expiresAt?: number, extra?: Partial<PfsAuth>): void {
  const cfg = loadConfig();
  cfg.pfs_auth = {
    ...(cfg.pfs_auth ?? {}),
    ...(extra ?? {}),
    token,
    expires_at: expiresAt ?? Date.now() + FALLBACK_TTL_MS,
  };
  saveConfig(cfg);
}

/**
 * Return a stored Bearer token, or throw. SYNCHRONOUS, so it cannot refresh -
 * access tokens last about an hour, so a long-lived process should call
 * ensureBearerToken() and let it refresh silently.
 */
export function getBearerToken(): string {
  const env = process.env.LETSFG_BEARER_TOKEN;
  if (env) return env;

  const auth = loadConfig().pfs_auth;
  if (auth?.token && Date.now() < auth.expires_at - REFRESH_SKEW_MS) {
    return auth.token;
  }
  if (auth?.refresh_token) {
    throw new BearerTokenError(
      'LetsFG token expired. Call ensureBearerToken() to refresh it, or run:  letsfg auth'
    );
  }

  throw new BearerTokenError(
    'No valid LetsFG Bearer token.\n' +
    '  Run:  letsfg auth        (connects a card at letsfg.co/connect - nothing is charged)\n' +
    '  Or:   export LETSFG_BEARER_TOKEN=<token>'
  );
}

/** Return a valid token, refreshing with the stored refresh token if needed. */
export async function ensureBearerToken(): Promise<string> {
  const env = process.env.LETSFG_BEARER_TOKEN;
  if (env) return env;

  const auth = loadConfig().pfs_auth;
  if (auth?.token && Date.now() < auth.expires_at - REFRESH_SKEW_MS) return auth.token;
  if (auth?.refresh_token && auth.client_id) return refreshAccessToken();
  return getBearerToken(); // throws with the right guidance
}

interface OAuthMeta {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

async function discover(): Promise<OAuthMeta> {
  const fallback: OAuthMeta = {
    authorization_endpoint: `${BASE_URL}/connect`,
    token_endpoint: `${DEV_ROOT}/oauth/token`,
    registration_endpoint: `${DEV_ROOT}/oauth/register`,
  };
  try {
    const resp = await fetch(`${DEV_ROOT}/.well-known/oauth-authorization-server`);
    if (!resp.ok) return fallback;
    const d = (await resp.json()) as Record<string, string>;
    return {
      authorization_endpoint: d.authorization_endpoint || fallback.authorization_endpoint,
      token_endpoint: d.token_endpoint || fallback.token_endpoint,
      registration_endpoint: d.registration_endpoint || fallback.registration_endpoint,
    };
  } catch {
    return fallback;
  }
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function postForm(
  url: string,
  form: Record<string, string>,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const resp = await fetch(url, {
    method: 'POST',
    // RFC 6749 4.1.3 - the token endpoint takes form encoding. The server also
    // accepts JSON, but sending the spec encoding keeps this honest.
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Client-Type': 'js-sdk' },
    body: new URLSearchParams(form).toString(),
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: resp.status, data };
}

function openBrowser(url: string): void {
  import('node:child_process')
    .then(({ exec }) => {
      const cmd =
        platform() === 'win32'
          ? `start "" "${url}"`
          : platform() === 'darwin'
            ? `open "${url}"`
            : `xdg-open "${url}"`;
      exec(cmd, () => {
        /* best effort, ignore failures */
      });
    })
    .catch(() => {
      /* best effort */
    });
}

/** Refresh the access token. Refresh tokens ROTATE - the new one is stored. */
export async function refreshAccessToken(): Promise<string> {
  const auth = loadConfig().pfs_auth;
  if (!auth?.refresh_token || !auth.client_id) {
    throw new BearerTokenError('No refresh token stored. Run:  letsfg auth');
  }
  const { token_endpoint } = await discover();
  const { status, data } = await postForm(token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: auth.refresh_token,
    client_id: auth.client_id,
  });
  if (status !== 200 || !data.access_token) {
    throw new BearerTokenError(`Could not refresh the LetsFG token (HTTP ${status}). Run:  letsfg auth`);
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in * 1000 : FALLBACK_TTL_MS;
  saveToken(String(data.access_token), Date.now() + expiresIn, {
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : auth.refresh_token,
    client_id: auth.client_id,
  });
  return String(data.access_token);
}

interface CallbackServer {
  port: number;
  waitForCode: () => Promise<string>;
  close: () => void;
}

function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let settle: ((code: string) => void) | null = null;
    let fail: ((e: Error) => void) | null = null;
    const codePromise = new Promise<string>((res, rej) => {
      settle = res;
      fail = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (err || !code) {
        res.end('<h1>LetsFG</h1><p>That did not complete. Nothing was charged - run <code>letsfg auth</code> again.</p>');
        fail?.(new BearerTokenError(`Authorisation failed: ${err || 'no code returned'}`));
        return;
      }
      // The state is the only thing tying this callback to the request we
      // started, so a mismatch is aborted rather than exchanged.
      if (state !== expectedState) {
        res.end('<h1>LetsFG</h1><p>State mismatch - nothing was charged. Run <code>letsfg auth</code> again.</p>');
        fail?.(new BearerTokenError('State mismatch on the OAuth callback - aborted.'));
        return;
      }
      res.end('<h1>LetsFG</h1><p>Connected. You can close this tab and go back to your terminal.</p>');
      settle?.(code);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      if (!port) {
        reject(new BearerTokenError('Could not open a local callback port.'));
        return;
      }
      resolve({ port, waitForCode: () => codePromise, close: () => server.close() });
    });
  });
}

/**
 * Interactive auth. Registers this CLI as an OAuth client, opens the LetsFG
 * connect page so a person can add a card (nothing charged), and stores the
 * resulting access + refresh tokens.
 */
export async function connectAuth(openBrowserFlag = true): Promise<string> {
  const meta = await discover();
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString('base64url');

  // Bind the loopback listener FIRST: redirect_uri has to match what we register
  // byte for byte, so the port must be known before registration.
  const { port, waitForCode, close } = await startCallbackServer(state);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const reg = await fetch(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'letsfg-cli',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    const regData = (await reg.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = typeof regData.client_id === 'string' ? regData.client_id : '';
    if (!reg.ok || !clientId) {
      throw new BearerTokenError(
        `Could not register with LetsFG (HTTP ${reg.status}). See ${BASE_URL}/for-agents`
      );
    }

    const authUrl =
      `${meta.authorization_endpoint}?response_type=code&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256` +
      `&state=${encodeURIComponent(state)}&scope=flights`;

    console.log('\n  LetsFG needs a card connected before it can search or book.');
    console.log('  Nothing is charged now - you pay the fare only when you book,');
    console.log('  and it is held, not taken, until the airline confirms.\n');
    console.log('  Open this and add a card (or pay 0.00 with Revolut Pay):\n');
    console.log(`     ${authUrl}\n`);
    if (openBrowserFlag) openBrowser(authUrl);
    process.stdout.write('  Waiting for you to finish... ');

    const code = await waitForCode();
    const { status, data } = await postForm(meta.token_endpoint, {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    if (status !== 200 || !data.access_token) {
      throw new BearerTokenError(
        `Could not complete authentication (HTTP ${status}). ${String(data.error_description || data.error || '')}`.trim()
      );
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in * 1000 : FALLBACK_TTL_MS;
    saveToken(String(data.access_token), Date.now() + expiresIn, {
      refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      client_id: clientId,
    });
    console.log('done. Card connected - the token refreshes itself from now on.');
    return String(data.access_token);
  } finally {
    close();
  }
}

/** Back-compat name: `letsfg auth` used to mean the Stripe lane, now it is /connect. */
export const paymentAuth = connectAuth;

/**
 * The Stripe enrolment lanes are gone. Kept so an older caller gets a real
 * explanation instead of a confusing 410 from the server.
 */
export async function verifyPaymentMethod(_opts?: unknown): Promise<never> {
  throw new BearerTokenError(
    'The Stripe lanes (setup_url / payment_method_id / card_token) were retired on 2026-09-02 ' +
      'and every token they issued was revoked. There is no endpoint that mints a token from ' +
      'card details. Run:  letsfg auth   (connects a card at ' + BASE_URL + '/connect - nothing is charged)'
  );
}
