import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LetsFG,
  LetsFGError,
  AuthenticationError,
  PaymentRequiredError,
  OfferExpiredError,
  ValidationError,
  ErrorCode,
  ErrorCategory,
  offerSummary,
  cheapestOffer,
  type FlightOffer,
  type FlightSearchResult,
} from './index.js';

// ── Class instantiation ───────────────────────────────────────────────────

describe('LetsFG class', () => {
  it('instantiates with no config', () => {
    const client = new LetsFG();
    assert.ok(client instanceof LetsFG);
  });

  it('instantiates with explicit config', () => {
    const client = new LetsFG({ apiKey: 'trav_test', timeout: 5000 });
    assert.ok(client instanceof LetsFG);
  });

  it('exposes expected methods', () => {
    const client = new LetsFG();
    assert.equal(typeof client.search, 'function');
    assert.equal(typeof client.unlock, 'function');
    assert.equal(typeof client.book, 'function');
    assert.equal(typeof client.resolveLocation, 'function');
    assert.equal(typeof client.me, 'function');
    assert.equal(typeof client.setupPayment, 'function');
  });

  it('exposes static register method', () => {
    assert.equal(typeof LetsFG.register, 'function');
  });
});

// ── Input validation — auth guard ─────────────────────────────────────────

describe('auth guard', () => {
  it('unlock throws AuthenticationError when no API key', async () => {
    const client = new LetsFG({ apiKey: '' });
    await assert.rejects(
      () => client.unlock('offer_123'),
      (err: unknown) => {
        assert.ok(err instanceof AuthenticationError);
        assert.equal((err as AuthenticationError).errorCode, ErrorCode.AUTH_INVALID);
        return true;
      },
    );
  });

  it('book throws AuthenticationError when no API key', async () => {
    const client = new LetsFG({ apiKey: '' });
    await assert.rejects(
      () => client.book('offer_123', [], 'test@example.com'),
      (err: unknown) => err instanceof AuthenticationError,
    );
  });

  it('me throws AuthenticationError when no API key', async () => {
    const client = new LetsFG({ apiKey: '' });
    await assert.rejects(
      () => client.me(),
      (err: unknown) => err instanceof AuthenticationError,
    );
  });
});

// ── Error classes ─────────────────────────────────────────────────────────

describe('error classes', () => {
  it('LetsFGError carries statusCode and errorCode', () => {
    const err = new LetsFGError('test error', 503, {}, ErrorCode.SERVICE_UNAVAILABLE);
    assert.equal(err.statusCode, 503);
    assert.equal(err.errorCode, ErrorCode.SERVICE_UNAVAILABLE);
    assert.equal(err.errorCategory, ErrorCategory.TRANSIENT);
    assert.equal(err.isRetryable, true);
    assert.ok(err instanceof Error);
  });

  it('AuthenticationError sets correct category', () => {
    const err = new AuthenticationError('unauthorized');
    assert.equal(err.statusCode, 401);
    assert.equal(err.errorCode, ErrorCode.AUTH_INVALID);
    assert.equal(err.errorCategory, ErrorCategory.BUSINESS);
    assert.equal(err.isRetryable, false);
  });

  it('PaymentRequiredError detects declined vs required', () => {
    const required = new PaymentRequiredError('payment required');
    assert.equal(required.errorCode, ErrorCode.PAYMENT_REQUIRED);

    const declined = new PaymentRequiredError('payment declined');
    assert.equal(declined.errorCode, ErrorCode.PAYMENT_DECLINED);
  });

  it('OfferExpiredError is non-retryable', () => {
    const err = new OfferExpiredError('offer expired');
    assert.equal(err.statusCode, 410);
    assert.equal(err.isRetryable, false);
  });

  it('ValidationError defaults to INVALID_PARAMETER', () => {
    const err = new ValidationError('bad input');
    assert.equal(err.errorCategory, ErrorCategory.VALIDATION);
    assert.equal(err.errorCode, ErrorCode.INVALID_PARAMETER);
    assert.equal(err.isRetryable, false);
  });
});

// ── ErrorCode constants ───────────────────────────────────────────────────

describe('ErrorCode', () => {
  it('transient codes exist', () => {
    assert.ok(ErrorCode.SUPPLIER_TIMEOUT);
    assert.ok(ErrorCode.RATE_LIMITED);
    assert.ok(ErrorCode.SERVICE_UNAVAILABLE);
    assert.ok(ErrorCode.NETWORK_ERROR);
  });

  it('validation codes exist', () => {
    assert.ok(ErrorCode.INVALID_IATA);
    assert.ok(ErrorCode.INVALID_DATE);
    assert.ok(ErrorCode.INVALID_PASSENGERS);
  });

  it('business codes exist', () => {
    assert.ok(ErrorCode.AUTH_INVALID);
    assert.ok(ErrorCode.PAYMENT_REQUIRED);
    assert.ok(ErrorCode.OFFER_EXPIRED);
    assert.ok(ErrorCode.BOOKING_FAILED);
  });
});

// ── Utility functions ─────────────────────────────────────────────────────

function makeOffer(price: number, id = 'offer_1'): FlightOffer {
  return {
    id,
    price,
    currency: 'EUR',
    price_formatted: `EUR ${price.toFixed(2)}`,
    outbound: {
      segments: [{
        airline: 'FR', airline_name: 'Ryanair', flight_no: 'FR1234',
        origin: 'GDN', destination: 'BER',
        origin_city: 'Gdańsk', destination_city: 'Berlin',
        departure: '2026-06-10T06:00:00', arrival: '2026-06-10T07:30:00',
        duration_seconds: 5400, cabin_class: 'M', aircraft: 'B738',
      }],
      total_duration_seconds: 5400,
      stopovers: 0,
    },
    inbound: null,
    airlines: ['FR'],
    owner_airline: 'FR',
    bags_price: {},
    availability_seats: null,
    conditions: {},
    is_locked: false,
    fetched_at: '2026-06-01T12:00:00Z',
    booking_url: 'https://ryanair.com/book/GDN-BER',
  };
}

describe('offerSummary', () => {
  it('returns a non-empty string', () => {
    const summary = offerSummary(makeOffer(49.99));
    assert.ok(typeof summary === 'string' && summary.length > 0);
    assert.ok(summary.includes('49.99'));
    assert.ok(summary.includes('GDN'));
    assert.ok(summary.includes('BER'));
  });

  it('includes airline and stop count', () => {
    const summary = offerSummary(makeOffer(100));
    assert.ok(summary.includes('FR'));
    assert.ok(summary.includes('0 stop'));
  });
});

describe('cheapestOffer', () => {
  it('returns null for empty results', () => {
    const result = { offers: [] } as unknown as FlightSearchResult;
    assert.equal(cheapestOffer(result), null);
  });

  it('returns the lowest-price offer', () => {
    const offers = [makeOffer(120, 'a'), makeOffer(80, 'b'), makeOffer(200, 'c')];
    const result = { offers } as unknown as FlightSearchResult;
    const cheapest = cheapestOffer(result);
    assert.equal(cheapest?.id, 'b');
    assert.equal(cheapest?.price, 80);
  });

  it('handles single offer', () => {
    const result = { offers: [makeOffer(50, 'only')] } as unknown as FlightSearchResult;
    assert.equal(cheapestOffer(result)?.id, 'only');
  });
});
