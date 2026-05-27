import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractClientIp, extractAllClientIps, ipMatchesBlockedCidr, pathIsAbuseProtected } from '../lib/ip-blocklist'

describe('ipMatchesBlockedCidr', () => {
  it('blocks IPs in a CIDR provided via env var', () => {
    const env = { LETSFG_BLOCKED_CIDRS: '10.0.0.0/8,192.168.1.0/24' }
    assert.equal(ipMatchesBlockedCidr('10.5.6.7', env), true)
    assert.equal(ipMatchesBlockedCidr('192.168.1.42', env), true)
  })

  it('does not block IPs outside the configured ranges', () => {
    const env = { LETSFG_BLOCKED_CIDRS: '10.0.0.0/8' }
    assert.equal(ipMatchesBlockedCidr('8.8.8.8', env), false)
    assert.equal(ipMatchesBlockedCidr('192.168.1.1', env), false)
  })

  it('blocks nothing when env var is unset (no source defaults)', () => {
    assert.equal(ipMatchesBlockedCidr('10.0.0.1', {}), false)
    assert.equal(ipMatchesBlockedCidr('66.102.8.36', {}), false)
  })

  it('rejects malformed input safely', () => {
    const env = { LETSFG_BLOCKED_CIDRS: '10.0.0.0/8' }
    assert.equal(ipMatchesBlockedCidr('', env), false)
    assert.equal(ipMatchesBlockedCidr('not-an-ip', env), false)
    assert.equal(ipMatchesBlockedCidr('999.0.0.1', env), false)
    assert.equal(ipMatchesBlockedCidr('10.0.0', env), false)
  })

  it('ignores malformed CIDRs in env var, applies valid ones', () => {
    const env = { LETSFG_BLOCKED_CIDRS: 'garbage,10.0.0.0/8,also-garbage/99' }
    assert.equal(ipMatchesBlockedCidr('10.1.2.3', env), true)
    assert.equal(ipMatchesBlockedCidr('8.8.8.8', env), false)
  })
})

describe('extractClientIp', () => {
  it('prefers cf-connecting-ip over xff (CF sets this, clients cannot forge it)', () => {
    const h = new Headers({ 'cf-connecting-ip': '203.0.113.5', 'x-forwarded-for': '8.8.8.8' })
    assert.equal(extractClientIp(h), '203.0.113.5')
  })

  it('falls back to leftmost xff when cf-connecting-ip absent', () => {
    const h = new Headers({ 'x-forwarded-for': '74.125.210.5, 169.254.1.1, 10.0.0.1' })
    assert.equal(extractClientIp(h), '74.125.210.5')
  })

  it('strips IPv4 port suffix', () => {
    const h = new Headers({ 'x-forwarded-for': '66.102.8.36:443' })
    assert.equal(extractClientIp(h), '66.102.8.36')
  })

  it('returns null when no client headers present', () => {
    assert.equal(extractClientIp(new Headers()), null)
  })
})

describe('extractAllClientIps', () => {
  it('returns every IP in the xff chain', () => {
    const h = new Headers({ 'x-forwarded-for': '8.8.8.8, 66.249.93.5, 35.191.0.1' })
    const ips = extractAllClientIps(h)
    assert.ok(ips.includes('8.8.8.8'))
    assert.ok(ips.includes('66.249.93.5'))
    assert.ok(ips.includes('35.191.0.1'))
  })

  it('includes cf-connecting-ip when present', () => {
    const h = new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' })
    const ips = extractAllClientIps(h)
    assert.ok(ips.includes('1.2.3.4'))
    assert.ok(ips.includes('5.6.7.8'))
  })

  it('detects spoofed xff: blocked ip in last position (appended by Cloud Run)', () => {
    const env = { LETSFG_BLOCKED_CIDRS: '66.249.64.0/19' }
    // attacker sends X-Forwarded-For: 8.8.8.8 (non-blocked); Cloud Run appends real IP 66.249.93.5
    const h = new Headers({ 'x-forwarded-for': '8.8.8.8, 66.249.93.5' })
    const ips = extractAllClientIps(h)
    assert.ok(ips.some(ip => ipMatchesBlockedCidr(ip, env)), 'blocked IP found in chain')
  })
})

describe('pathIsAbuseProtected', () => {
  it('matches the expensive search paths', () => {
    assert.equal(pathIsAbuseProtected('/results'), true)
    assert.equal(pathIsAbuseProtected('/results/ws_abc123'), true)
    assert.equal(pathIsAbuseProtected('/api/results/ws_abc123'), true)
    assert.equal(pathIsAbuseProtected('/api/search'), true)
    assert.equal(pathIsAbuseProtected('/api/offer/foo'), true)
    assert.equal(pathIsAbuseProtected('/api/parse-query'), true)
    assert.equal(pathIsAbuseProtected('/api/date-grid'), true)
    assert.equal(pathIsAbuseProtected('/api/rank'), true)
  })

  it('does NOT match marketing or PFP paths (Googlebot can still crawl)', () => {
    assert.equal(pathIsAbuseProtected('/'), false)
    assert.equal(pathIsAbuseProtected('/en'), false)
    assert.equal(pathIsAbuseProtected('/en/flights/poa-cun'), false)
    assert.equal(pathIsAbuseProtected('/developers'), false)
    assert.equal(pathIsAbuseProtected('/llms.txt'), false)
  })
})
