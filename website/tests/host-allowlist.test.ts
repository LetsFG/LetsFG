import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedHost } from '../lib/host-allowlist'

describe('isAllowedHost', () => {
  it('allows letsfg.co and known subdomains', () => {
    assert.equal(isAllowedHost('letsfg.co', {}), true)
    assert.equal(isAllowedHost('www.letsfg.co', {}), true)
    assert.equal(isAllowedHost('docs.letsfg.co', {}), true)
    assert.equal(isAllowedHost('stats.letsfg.co', {}), true)
    assert.equal(isAllowedHost('api.letsfg.co', {}), true)
  })

  it('blocks raw Cloud Run .run.app URLs — the bot bypass path', () => {
    assert.equal(
      isAllowedHost('letsfg-website-preview-876385716101.us-central1.run.app', {}),
      false,
    )
    assert.equal(
      isAllowedHost('letsfg-website-preview-qryvus4jia-uc.a.run.app', {}),
      false,
    )
    assert.equal(
      isAllowedHost('hotfix-ipblock---letsfg-website-preview-qryvus4jia-uc.a.run.app', {}),
      false,
    )
  })

  it('blocks Firebase Hosting default URLs', () => {
    assert.equal(isAllowedHost('letsfg-preview-sms-caller.web.app', {}), false)
    assert.equal(isAllowedHost('letsfg-preview-sms-caller.firebaseapp.com', {}), false)
  })

  it('blocks unrelated hosts', () => {
    assert.equal(isAllowedHost('example.com', {}), false)
    assert.equal(isAllowedHost('evil.example.com', {}), false)
  })

  it('rejects suffix-confusion attacks (no implicit prefix match)', () => {
    assert.equal(isAllowedHost('notletsfg.co', {}), false)
    assert.equal(isAllowedHost('letsfg.com', {}), false)
    assert.equal(isAllowedHost('letsfg.co.evil.com', {}), false)
    assert.equal(isAllowedHost('xletsfg.co', {}), false)
  })

  it('strips port suffix before matching', () => {
    assert.equal(isAllowedHost('letsfg.co:443', {}), true)
    assert.equal(isAllowedHost('www.letsfg.co:8080', {}), true)
  })

  it('is case-insensitive', () => {
    assert.equal(isAllowedHost('LetsFG.co', {}), true)
    assert.equal(isAllowedHost('WWW.LETSFG.CO', {}), true)
  })

  it('allows localhost only in non-prod environments', () => {
    assert.equal(isAllowedHost('localhost', { NODE_ENV: 'development' }), true)
    assert.equal(isAllowedHost('localhost:3000', { NODE_ENV: 'development' }), true)
    assert.equal(isAllowedHost('127.0.0.1', { NODE_ENV: 'test' }), true)
    assert.equal(isAllowedHost('localhost', { NODE_ENV: 'production' }), false)
    assert.equal(isAllowedHost('127.0.0.1', { NODE_ENV: 'production' }), false)
  })

  it('honours LETSFG_ALLOW_RUNAPP_DIRECT escape hatch for tagged revisions', () => {
    const runapp = 'hotfix-ipblock---letsfg-website-preview-qryvus4jia-uc.a.run.app'
    assert.equal(isAllowedHost(runapp, {}), false)
    assert.equal(isAllowedHost(runapp, { LETSFG_ALLOW_RUNAPP_DIRECT: '1' }), true)
    // Even with the escape hatch on, non-runapp hosts still need the regular allowlist.
    assert.equal(isAllowedHost('evil.com', { LETSFG_ALLOW_RUNAPP_DIRECT: '1' }), false)
  })

  it('handles null/empty/whitespace safely', () => {
    assert.equal(isAllowedHost(null, {}), false)
    assert.equal(isAllowedHost(undefined, {}), false)
    assert.equal(isAllowedHost('', {}), false)
    assert.equal(isAllowedHost('   ', {}), false)
  })
})
