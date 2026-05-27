// Live end-to-end test for the agent access token flow.
//
// Usage:
//   Step 1 — get a challenge:
//     npx tsx scripts/test-agent-access-live.ts request [BASE_URL]
//
//   Step 2 — tweet the printed template, then verify:
//     npx tsx scripts/test-agent-access-live.ts verify <tweet_url> <challenge_signed> [BASE_URL]
//
//   Step 3 — test the issued token on a search:
//     npx tsx scripts/test-agent-access-live.ts use <token> [BASE_URL]
//
// BASE_URL defaults to https://letsfg.co

const BASE_URL = (process.argv.find(a => a.startsWith('http')) ?? 'https://letsfg.co').replace(/\/$/, '')
const [, , command, arg1, arg2] = process.argv

async function request() {
  console.log(`\nRequesting challenge from ${BASE_URL}/api/agent-access/request …\n`)
  const res = await fetch(`${BASE_URL}/api/agent-access/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: 'letsfg.co' },
  })
  const body = await res.json()
  if (!res.ok) {
    console.error('ERROR', res.status, body)
    process.exit(1)
  }

  console.log('─────────────────────────────────────────────────')
  console.log('Challenge code:  ', body.challenge_code)
  console.log('Expires at:      ', new Date(body.expires_at).toISOString())
  console.log('─────────────────────────────────────────────────')
  console.log('\nTweet this (copy exactly):')
  console.log('\n' + body.tweet_template + '\n')
  console.log('Then run:')
  console.log(`  npx tsx scripts/test-agent-access-live.ts verify <your_tweet_url> "${body.challenge_signed}" ${BASE_URL}`)
}

async function verify(tweetUrl: string, challengeSigned: string) {
  console.log(`\nVerifying tweet ${tweetUrl} …\n`)
  const res = await fetch(`${BASE_URL}/api/agent-access/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Host: 'letsfg.co' },
    body: JSON.stringify({ tweet_url: tweetUrl, challenge_signed: challengeSigned }),
  })
  const body = await res.json()
  if (!res.ok) {
    console.error('ERROR', res.status, body)
    process.exit(1)
  }

  console.log('─────────────────────────────────────────────────')
  console.log('Token issued for: @' + body.handle)
  console.log('Expires at:       ', new Date(body.expires_at).toISOString())
  console.log('Token:            ', body.token)
  console.log('─────────────────────────────────────────────────')
  console.log('\nTo use:')
  console.log(`  Authorization: Bearer ${body.token}`)
  console.log('\nTest it now:')
  console.log(`  npx tsx scripts/test-agent-access-live.ts use "${body.token}" ${BASE_URL}`)
}

async function use(token: string) {
  console.log(`\nTesting token on ${BASE_URL}/api/search …\n`)
  // Just hit parse-query as a lightweight test — no Gemini credits wasted
  const res = await fetch(`${BASE_URL}/api/parse-query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Host': 'letsfg.co',
    },
    body: JSON.stringify({ query: 'flights from Barcelona to London next week' }),
  })
  const body = await res.json()
  console.log('Status:', res.status)
  console.log('Rate-limit remaining:', res.headers.get('x-letsfg-ratelimit-remaining'))
  if (res.ok) {
    console.log('\nResponse origin/destination:', body.origin, '→', body.destination)
    console.log('\n✅ Token works!')
  } else {
    console.error('ERROR:', body)
    process.exit(1)
  }
}

switch (command) {
  case 'request': await request(); break
  case 'verify':  await verify(arg1, arg2); break
  case 'use':     await use(arg1); break
  default:
    console.error('Usage: npx tsx scripts/test-agent-access-live.ts <request|verify|use> [args…]')
    process.exit(1)
}
