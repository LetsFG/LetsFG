import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '../../../../lib/stripe'
import { getLetsfgAnalyticsApiBase, withLetsfgWebsiteApiHeaders } from '../../../../lib/letsfg-api'

function verifyAdminKey(req: NextRequest): boolean {
  const expectedKey = process.env.ANALYTICS_ADMIN_KEY
  if (!expectedKey) return false
  // Support both 'admin_key' (fetchAPI convention) and 'adminKey' and header
  const fromQuery = req.nextUrl.searchParams.get('admin_key') ?? req.nextUrl.searchParams.get('adminKey')
  const fromHeader = req.headers.get('x-admin-key')
  return fromQuery === expectedKey || fromHeader === expectedKey
}

/**
 * GET /api/admin/stripe-payments
 *
 * Lists paid Stripe Checkout Sessions within a time window.
 * Admin-only (requires ANALYTICS_ADMIN_KEY).
 *
 * Query params:
 *  - adminKey: string (required)
 *  - hours: number (default 168 = 7 days)
 *  - limit: number (default 100, max 100)
 */
export async function GET(req: NextRequest) {
  if (!verifyAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const hours = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('hours') ?? '168'), 1), 8760)
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '100'), 100)
  const createdAfter = Math.floor(Date.now() / 1000) - hours * 3600

  try {
    const stripe = getStripe()

    // Collect all paid checkout sessions in the window (auto-paging up to limit)
    const payments: object[] = []
    for await (const session of stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: createdAfter },
      expand: ['data.line_items'],
    })) {
      if (session.payment_status !== 'paid') continue
      payments.push({
        session_id: session.id,
        search_id: session.metadata?.search_id ?? null,
        offer_id: session.metadata?.offer_id ?? null,
        lfg_uid: session.metadata?.lfg_uid ?? null,
        amount: session.amount_total != null ? session.amount_total / 100 : null,
        currency: session.currency?.toUpperCase() ?? null,
        customer_email: session.customer_details?.email ?? null,
        created_at: new Date(session.created * 1000).toISOString(),
        payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      })
      if (payments.length >= limit) break
    }

    payments.sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))

    return NextResponse.json({
      count: payments.length,
      hours,
      payments,
    })
  } catch (err: any) {
    console.error('[stripe-payments] Error:', err)
    return NextResponse.json({ error: err?.message ?? 'Stripe error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/stripe-payments
 *
 * Syncs paid Stripe Checkout Sessions into the analytics store.
 * Upserts each payment as a search session with payment_verified_at + revenue.
 * Safe to call multiple times — analytics upsert is idempotent.
 *
 * Body (JSON):
 *  - adminKey: string (required)
 *  - hours: number (default 720 = 30 days)
 */
export async function POST(req: NextRequest) {
  if (!verifyAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  let hours = 720
  try {
    const body = await req.json()
    if (body.hours) hours = Math.min(Math.max(parseInt(body.hours), 1), 8760)
  } catch (_) {
    // use default
  }

  const createdAfter = Math.floor(Date.now() / 1000) - hours * 3600
  const ANALYTICS_API_BASE = getLetsfgAnalyticsApiBase()

  try {
    const stripe = getStripe()

    let synced = 0
    let skipped = 0
    const errors: string[] = []

    for await (const session of stripe.checkout.sessions.list({
      limit: 100,
      created: { gte: createdAfter },
    })) {
      if (session.payment_status !== 'paid') {
        skipped++
        continue
      }

      const searchId = session.metadata?.search_id
      if (!searchId) {
        skipped++
        continue
      }

      // Check if the session already exists in analytics and is share-verified.
      // If so, skip — we never want to overwrite a share unlock with a payment.
      try {
        const checkResp = await fetch(
          `${ANALYTICS_API_BASE}/api/v1/analytics/search-sessions/${encodeURIComponent(searchId)}?admin_key=${encodeURIComponent(process.env.ANALYTICS_ADMIN_KEY ?? '')}`,
          {
            headers: withLetsfgWebsiteApiHeaders(),
            signal: AbortSignal.timeout(5000),
          }
        )
        if (checkResp.ok) {
          const existing = await checkResp.json()
          if (existing?.share_verified_at) {
            skipped++
            continue
          }
        } else if (checkResp.status === 404) {
          // Session doesn't exist at all — skip rather than create an orphan shell
          // that would appear in the 24h window with created_at = now
          skipped++
          continue
        }
      } catch (_) {
        // Can't verify — skip to be safe
        skipped++
        continue
      }

      const revenue = session.amount_total != null ? session.amount_total / 100 : undefined
      const paidAt = new Date(session.created * 1000).toISOString()
      const offerId = session.metadata?.offer_id ?? ''

      try {
        await fetch(`${ANALYTICS_API_BASE}/api/v1/analytics/search-sessions/upsert`, {
          method: 'POST',
          headers: withLetsfgWebsiteApiHeaders({
            'Content-Type': 'application/json',
            'Origin': 'https://letsfg.co',
            'Referer': 'https://letsfg.co/',
            'User-Agent': 'LetsFG Stripe-Sync/1.0',
          }),
          body: JSON.stringify({
            search_id: searchId,
            ...(revenue != null ? { revenue } : {}),
            event: {
              type: 'payment_verified',
              at: paidAt,
              data: {
                offer_id: offerId,
                stripe_session_id: session.id,
                source: 'stripe-sync',
              },
            },
          }),
          signal: AbortSignal.timeout(8000),
        })
        synced++
      } catch (upsertErr: any) {
        errors.push(`${searchId}: ${upsertErr?.message}`)
      }
    }

    return NextResponse.json({
      synced,
      skipped,
      hours,
      errors: errors.slice(0, 10),
    })
  } catch (err: any) {
    console.error('[stripe-sync] Error:', err)
    return NextResponse.json({ error: err?.message ?? 'Stripe error' }, { status: 500 })
  }
}
