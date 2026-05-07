import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const API_BASE = process.env.LETSFG_API_URL || 'https://api.letsfg.co'
const WEBSITE_API_KEY = process.env.LETSFG_WEBSITE_API_KEY || ''
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

function verifyTelegramAuth(user: TelegramUser, botToken: string): boolean {
  if (!botToken) return false

  const { hash, ...fields } = user
  const dataCheckString = (Object.keys(fields) as Array<keyof typeof fields>)
    .sort()
    .map(k => `${k}=${fields[k]}`)
    .join('\n')

  const secretKey = crypto.createHash('sha256').update(botToken).digest()
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (hmac !== hash) return false

  // Reject auth data older than 10 minutes
  const ageSeconds = Math.floor(Date.now() / 1000) - user.auth_date
  return ageSeconds < 600
}

export async function POST(req: NextRequest) {
  if (!WEBSITE_API_KEY) {
    return NextResponse.json({ error: 'Monitor service not configured' }, { status: 503 })
  }
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'Telegram not configured' }, { status: 503 })
  }

  let body: { monitor_id?: unknown; user?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { monitor_id, user } = body

  if (typeof monitor_id !== 'string' || !monitor_id.trim()) {
    return NextResponse.json({ error: 'Missing monitor_id' }, { status: 400 })
  }
  if (!user || typeof user !== 'object') {
    return NextResponse.json({ error: 'Missing Telegram user data' }, { status: 400 })
  }

  const telegramUser = user as TelegramUser

  if (!verifyTelegramAuth(telegramUser, TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'Invalid Telegram authentication' }, { status: 401 })
  }

  try {
    const resp = await fetch(
      `${API_BASE}/api/v1/monitors/${encodeURIComponent(monitor_id)}/subscribe-telegram?chat_id=${telegramUser.id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': WEBSITE_API_KEY,
        },
        signal: AbortSignal.timeout(10_000),
      }
    )

    const data = await resp.json()
    if (!resp.ok) {
      const message = typeof data?.detail === 'string' ? data.detail : 'Failed to link Telegram'
      return NextResponse.json({ error: message }, { status: resp.status })
    }

    return NextResponse.json({ ok: true, first_name: telegramUser.first_name })
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
}
