import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// auth.ts resolves its config path from APPDATA (win32) or HOME (posix) at
// call time, so redirecting both env vars to a scratch dir before each test
// keeps this suite from ever touching a real ~/.letsfg/config.json.
let scratchDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'letsfg-auth-test-'));
  savedEnv = {
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    LETSFG_BEARER_TOKEN: process.env.LETSFG_BEARER_TOKEN,
  };
  process.env.APPDATA = scratchDir;
  process.env.HOME = scratchDir;
  delete process.env.LETSFG_BEARER_TOKEN;
});

afterEach(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  rmSync(scratchDir, { recursive: true, force: true });
});

describe('getBearerToken / saveToken', () => {
  it('throws BearerTokenError when nothing is configured', async () => {
    const { getBearerToken, BearerTokenError } = await import('./auth.js');
    assert.throws(() => getBearerToken(), BearerTokenError);
  });

  it('returns LETSFG_BEARER_TOKEN env var immediately, without touching the config file', async () => {
    process.env.LETSFG_BEARER_TOKEN = 'env-token-123';
    const { getBearerToken } = await import('./auth.js');
    assert.equal(getBearerToken(), 'env-token-123');
  });

  it('round-trips a saved token through the config file', async () => {
    const { saveToken, getBearerToken } = await import('./auth.js');
    saveToken('saved-token-456', Date.now() + 90 * 24 * 3600 * 1000);
    assert.equal(getBearerToken(), 'saved-token-456');
  });

  it('treats a saved token past its expiry (minus buffer) as invalid', async () => {
    const { saveToken, getBearerToken, BearerTokenError } = await import('./auth.js');
    saveToken('expired-token', Date.now() + 1000); // expires in 1s, well inside the 1h buffer
    assert.throws(() => getBearerToken(), BearerTokenError);
  });
});

describe('requestEnrolment', () => {
  it('returns the body on a 402 response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      status: 402,
      json: async () => ({ setup_url: 'https://checkout.stripe.com/fake', setup_session_id: 'cs_fake' }),
    })) as typeof fetch;

    try {
      const { requestEnrolment } = await import('./auth.js');
      const data = await requestEnrolment();
      assert.equal(data.setup_session_id, 'cs_fake');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws BearerTokenError on an unexpected status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      status: 500,
      json: async () => ({ error: 'server error' }),
    })) as typeof fetch;

    try {
      const { requestEnrolment, BearerTokenError } = await import('./auth.js');
      await assert.rejects(() => requestEnrolment(), BearerTokenError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('verifyPaymentMethod', () => {
  it('saves and returns the token on success', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return {
        status: 200,
        json: async () => ({ token: 'verified-token', expires_at: '2026-10-27T00:00:00Z' }),
      };
    }) as typeof fetch;

    try {
      const { verifyPaymentMethod, getBearerToken } = await import('./auth.js');
      const token = await verifyPaymentMethod({ cardToken: 'tok_test' });
      assert.equal(token, 'verified-token');
      assert.equal(capturedBody?.card_token, 'tok_test');
      assert.equal(getBearerToken(), 'verified-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws BearerTokenError when no credential option is given', async () => {
    const { verifyPaymentMethod, BearerTokenError } = await import('./auth.js');
    await assert.rejects(() => verifyPaymentMethod({}), BearerTokenError);
  });

  it('throws BearerTokenError when the response has no token', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      status: 200,
      json: async () => ({}),
    })) as typeof fetch;

    try {
      const { verifyPaymentMethod, BearerTokenError } = await import('./auth.js');
      await assert.rejects(() => verifyPaymentMethod({ setupSessionId: 'cs_fake' }), BearerTokenError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
