import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractClientIp, ipMatchesBlockedCidr, pathIsAbuseProtected } from '../lib/ip-blocklist'

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
  it('takes the leftmost x-forwarded-for entry', () => {
    const h = new Headers({ 'x-forwarded-for': '74.125.210.5, 169.254.1.1, 10.0.0.1' })
    assert.equal(extractClientIp(h), '74.125.210.5')
  })

  it('strips IPv4 port suffix', () => {
    const h = new Headers({ 'x-forwarded-for': '66.102.8.36:443' })
    assert.equal(extractClientIp(h), '66.102.8.36')
  })

  it('falls back to cf-connecting-ip when xff absent', () => {
    const h = new Headers({ 'cf-connecting-ip': '203.0.113.5' })
    assert.equal(extractClientIp(h), '203.0.113.5')
  })

  it('returns null when no client headers present', () => {
    assert.equal(extractClientIp(new Headers()), null)
  })
})

describe('pathIsAbuseProtected', () => {
  it('matches the expensive search paths', () => {
    assert.equal(pathIsAbuseProtected('/results'), true)
    assert.equal(pathIsAbuseProtected('/results/ws_abc123'), true)
    assert.equal(pathIsAbuseProtected('/api/results/ws_abc123'), true)
    assert.equal(pathIsAbuseProtected('/api/search'), true)
    assert.equal(pathIsAbuseProtected('/api/offer/foo'), true)
  })

  it('does NOT match marketing or PFP paths (Googlebot can still crawl)', () => {
    assert.equal(pathIsAbuseProtected('/'), false)
    assert.equal(pathIsAbuseProtected('/en'), false)
    assert.equal(pathIsAbuseProtected('/en/flights/poa-cun'), false)
    assert.equal(pathIsAbuseProtected('/developers'), false)
    assert.equal(pathIsAbuseProtected('/llms.txt'), false)
  })
})
