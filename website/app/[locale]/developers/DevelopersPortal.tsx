'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type DeveloperStatus = {
  agent_id: string
  agent_name: string
  email: string
  api_keys_active: number
  payment_ready: boolean
  developer_api: {
    api_access_enabled: boolean
    billing_plan: string
    price_per_search_cents: number
    minimum_top_up_cents: number
    balance_cents: number
    billing_currency: string
    auto_refill_enabled: boolean
    auto_refill_amount_cents: number
    last_top_up_at: string
    api_key_last_rotated_at: string
  }
  usage: {
    total_requests: number
    total_searches: number
    total_unlocks: number
    total_bookings: number
    total_spent_cents: number
  }
}

const STORAGE_KEY = 'letsfg:developer-api-key'
const MIN_TOP_UP_CENTS = 500
const DEVELOPER_API_BASE = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://letsfg.co'}/developers/api/v1`

function centsToUsd(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

async function postJson<T>(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Request failed')
  }
  return data
}

export default function DevelopersPortal({ locale }: { locale: string }) {
  const searchParams = useSearchParams()
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<DeveloperStatus | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [handledCheckoutSessionId, setHandledCheckoutSessionId] = useState('')
  const [topUpAmount, setTopUpAmount] = useState(MIN_TOP_UP_CENTS)
  const [autoRefillEnabled, setAutoRefillEnabled] = useState(false)
  const [autoRefillAmount, setAutoRefillAmount] = useState(MIN_TOP_UP_CENTS)

  const cardReady = Boolean(status?.payment_ready)
  const apiReady = Boolean(status?.developer_api.api_access_enabled)
  const activeKeyCount = status?.api_keys_active ?? (apiKey ? 1 : 0)
  const totalRequests = status?.usage.total_requests ?? 0
  const totalSearches = status?.usage.total_searches ?? 0
  const totalUnlocks = status?.usage.total_unlocks ?? 0
  const totalBookings = status?.usage.total_bookings ?? 0
  const balanceCents = status?.developer_api.balance_cents ?? 0
  const balanceSearches = status
    ? Math.floor(status.developer_api.balance_cents / status.developer_api.price_per_search_cents)
    : 0

  async function refreshStatus(keyOverride?: string) {
    const currentKey = (keyOverride || apiKey).trim()
    if (!currentKey) return
    const data = await postJson<DeveloperStatus>('/api/developers/status', { apiKey: currentKey })
    setStatus(data)
  }

  function openStripeUrl(url: string, preferNewTab = false) {
    if (preferNewTab) {
      const popup = window.open('', '_blank')
      if (popup) {
        popup.opener = null
        popup.location.href = url
        popup.focus()
        return
      }
    }
    window.location.href = url
  }

  useEffect(() => {
    const storedKey = window.sessionStorage.getItem(STORAGE_KEY) || ''
    if (storedKey) {
      setApiKey(storedKey)
    }
  }, [])

  useEffect(() => {
    const syncStoredKey = () => {
      const storedKey = window.sessionStorage.getItem(STORAGE_KEY) || ''
      if (!storedKey) return
      if (storedKey !== apiKey) {
        setApiKey(storedKey)
        return
      }
      if (!status) {
        void refreshStatus(storedKey).catch(() => {
          /* noop */
        })
      }
    }

    window.addEventListener('pageshow', syncStoredKey)
    window.addEventListener('focus', syncStoredKey)
    return () => {
      window.removeEventListener('pageshow', syncStoredKey)
      window.removeEventListener('focus', syncStoredKey)
    }
  }, [apiKey, status])

  useEffect(() => {
    if (!apiKey) {
      setStatus(null)
      return
    }
    void refreshStatus(apiKey).catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : 'Could not load developer account.')
    })
  }, [apiKey])

  useEffect(() => {
    if (!status) return
    setAutoRefillEnabled(status.developer_api.auto_refill_enabled)
    if (status.developer_api.auto_refill_amount_cents > 0) {
      setAutoRefillAmount(status.developer_api.auto_refill_amount_cents)
    }
    if (status.developer_api.minimum_top_up_cents > topUpAmount) {
      setTopUpAmount(status.developer_api.minimum_top_up_cents)
    }
  }, [status, topUpAmount])

  useEffect(() => {
    if (topUpAmount < MIN_TOP_UP_CENTS) {
      setTopUpAmount(MIN_TOP_UP_CENTS)
    }
    if (autoRefillAmount < MIN_TOP_UP_CENTS) {
      setAutoRefillAmount(MIN_TOP_UP_CENTS)
    }
  }, [topUpAmount, autoRefillAmount])

  useEffect(() => {
    const paymentState = searchParams.get('developerSetup')
    const checkoutSessionId = searchParams.get('session_id')?.trim() || ''
    if (!paymentState) return

    const clearStripeReturnParams = () => {
      window.history.replaceState({}, '', window.location.pathname)
    }

    if (paymentState === 'card-connected' && checkoutSessionId && handledCheckoutSessionId !== checkoutSessionId) {
      clearStripeReturnParams()
      setHandledCheckoutSessionId(checkoutSessionId)
      setBusyAction('complete-checkout')
      setError('')
      setMessage('')

      void postJson<{ api_key: string; message?: string }>('/api/developers/complete-checkout', {
        sessionId: checkoutSessionId,
        apiKey: apiKey || undefined,
      })
        .then(async (data) => {
          window.sessionStorage.setItem(STORAGE_KEY, data.api_key)
          setApiKey(data.api_key)
          setMessage(data.message || 'Stripe setup complete. Your developer account is ready.')
          await refreshStatus(data.api_key)
        })
        .catch((nextError: unknown) => {
          setError(nextError instanceof Error ? nextError.message : 'Could not finish Stripe setup.')
        })
        .finally(() => {
          setBusyAction(null)
        })
      return
    }

    if (!apiKey) return

    if (paymentState === 'card-connected') {
      clearStripeReturnParams()
      setMessage('Card saved. You can fund the balance whenever you are ready.')
      void refreshStatus(apiKey).catch(() => {
        /* noop */
      })
    }
    if (paymentState === 'card-cancelled') {
      clearStripeReturnParams()
      setError('Card setup was cancelled before completion.')
    }
  }, [searchParams, apiKey, handledCheckoutSessionId])

  async function handleStartWithStripe() {
    setBusyAction('start-checkout')
    setError('')
    setMessage('')

    try {
      const data = await postJson<{ checkout_url: string }>('/api/developers/payment-session', {
        locale,
      })
      openStripeUrl(data.checkout_url)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not start Stripe checkout.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleConnectCard() {
    setBusyAction('payment')
    setError('')
    setMessage('')

    try {
      if (cardReady) {
        const data = await postJson<{ portal_url: string }>('/api/developers/billing-portal', {
          apiKey,
          locale,
        })
        openStripeUrl(data.portal_url, true)
        setMessage('Stripe billing portal opened in a new tab.')
      } else {
        const data = await postJson<{ checkout_url: string }>('/api/developers/payment-session', {
          apiKey,
          locale,
        })
        openStripeUrl(data.checkout_url)
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not open Stripe.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleTopUp() {
    setBusyAction('top-up')
    setError('')
    setMessage('')

    try {
      const data = await postJson<{ message?: string }>('/api/developers/top-up', {
        apiKey,
        amountCents: topUpAmount,
        autoRefillEnabled,
        autoRefillAmountCents: autoRefillEnabled ? autoRefillAmount : undefined,
      })
      setMessage(data.message || 'Balance funded successfully.')
      await refreshStatus(apiKey)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not fund the prepaid balance.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleRotateKey() {
    setBusyAction('rotate')
    setError('')
    setMessage('')

    try {
      const data = await postJson<{ api_key: string; message?: string }>('/api/developers/rotate-key', {
        apiKey,
      })
      window.sessionStorage.setItem(STORAGE_KEY, data.api_key)
      setApiKey(data.api_key)
      setMessage(data.message || 'API key rotated successfully.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not rotate your API key.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCopyKey() {
    try {
      await navigator.clipboard.writeText(apiKey)
      setMessage('API key copied to clipboard.')
    } catch {
      setError('Clipboard access was blocked. Copy the key manually.')
    }
  }

  function clearBrowserSession() {
    window.sessionStorage.removeItem(STORAGE_KEY)
    setApiKey('')
    setStatus(null)
    setHandledCheckoutSessionId('')
    setMessage('Developer key removed from this browser session.')
    setError('')
  }

  return (
    <section className="dev-section dev-section--compact">
      <div className="dev-shell dev-portal-shell">
        {(message || error) && (
          <div className={`dev-banner ${error ? 'dev-banner--error' : 'dev-banner--success'}`} role="status">
            {error || message}
          </div>
        )}

        {!apiKey ? (
          <div className="dev-auth-wrap">
            <article className="dev-auth-card">
              <span className="dev-section-kicker">Get API access</span>
              <h2 className="dev-auth-title">Setup API access.</h2>
              <p className="dev-inline-note">
                We use your payment method to authenticate your developer account and issue your API key, so there is no separate signup or login form here.
              </p>
              <div className="dev-inline-actions">
                <button
                  type="button"
                  className="dev-button dev-button--primary dev-button--stripe"
                  onClick={() => {
                    void handleStartWithStripe()
                  }}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'complete-checkout'
                    ? 'Finishing setup...'
                    : busyAction === 'start-checkout'
                      ? 'Opening Stripe...'
                      : 'Continue with Stripe'}
                </button>
              </div>
            </article>
          </div>
        ) : (
          <div className="dev-account-shell">
            <section className="dev-usage-strip" aria-label="Developer usage">
              <div className="dev-account-block-head">
                <div>
                  <span className="dev-section-kicker">Usage</span>
                  <h2 className="dev-auth-title">{status?.agent_name || 'Developer account'}</h2>
                </div>
                <button
                  type="button"
                  className="dev-button dev-button--ghost"
                  onClick={() => {
                    void handleConnectCard()
                  }}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'payment' ? 'Opening Stripe...' : cardReady ? 'Open billing portal' : 'Connect card in Stripe'}
                </button>
              </div>

              <div className="dev-usage-list">
                <div className="dev-usage-item"><span>Requests</span><strong>{totalRequests}</strong></div>
                <div className="dev-usage-item"><span>Searches</span><strong>{totalSearches}</strong></div>
                <div className="dev-usage-item"><span>Unlocks</span><strong>{totalUnlocks}</strong></div>
                <div className="dev-usage-item"><span>Bookings</span><strong>{totalBookings}</strong></div>
              </div>
            </section>

            <section className="dev-account-block">
              <div className="dev-account-block-head">
                <div>
                  <span className="dev-section-kicker">API keys</span>
                  <h3 className="dev-account-heading">API keys</h3>
                </div>
                <span className="dev-inline-note">{activeKeyCount} active</span>
              </div>

              <div className="dev-key-row">
                <input className="dev-input dev-key-input" value={apiKey} readOnly />
                <button
                  type="button"
                  className="dev-button dev-button--ghost"
                  onClick={() => {
                    void handleCopyKey()
                  }}
                >
                  Copy
                </button>
              </div>

              <p className="dev-inline-note">
                Public API base: {DEVELOPER_API_BASE}. Search with {DEVELOPER_API_BASE}/flights/search using this key.
              </p>

              <div className="dev-inline-actions dev-inline-actions--secondary">
                <button
                  type="button"
                  className="dev-button dev-button--ghost"
                  onClick={() => {
                    void handleRotateKey()
                  }}
                  disabled={busyAction !== null}
                >
                  {busyAction === 'rotate' ? 'Rotating...' : 'Rotate API key'}
                </button>
                <button type="button" className="dev-button dev-button--ghost" onClick={clearBrowserSession}>
                  Logout
                </button>
              </div>
            </section>

            <div className="dev-balance-wrap">
              <section className="dev-balance-card" aria-label="Account balance">
                <span className="dev-balance-label">Your account balance</span>
                <strong className="dev-balance-value">{centsToUsd(balanceCents)}</strong>
                <p className="dev-inline-note">
                  {apiReady ? `${balanceSearches} searches left at your current rate.` : 'Add funds whenever you want to start using the API.'}
                </p>
              </section>
            </div>

            <section className="dev-account-block">
              <div className="dev-account-block-head">
                <div>
                  <span className="dev-section-kicker">Add funds</span>
                  <h3 className="dev-account-heading">Add funds</h3>
                </div>
              </div>

              <div className="dev-field-grid dev-field-grid--funding">
                <label className="dev-field">
                  <span>Top-up amount (USD)</span>
                  <input
                    className="dev-input"
                    type="number"
                    min={MIN_TOP_UP_CENTS / 100}
                    step="1"
                    value={topUpAmount / 100}
                    onChange={(event) => setTopUpAmount(Math.max(MIN_TOP_UP_CENTS, Math.round(Number(event.target.value || '0') * 100)))}
                    disabled={!cardReady || busyAction !== null}
                  />
                </label>

                <label className="dev-field dev-field--toggle">
                  <span>Automatic refill</span>
                  <input
                    type="checkbox"
                    checked={autoRefillEnabled}
                    onChange={(event) => setAutoRefillEnabled(event.target.checked)}
                    disabled={busyAction !== null}
                  />
                </label>

                {autoRefillEnabled && (
                  <label className="dev-field">
                    <span>Automatic refill amount (USD)</span>
                    <input
                      className="dev-input"
                      type="number"
                      min={MIN_TOP_UP_CENTS / 100}
                      step="1"
                      value={autoRefillAmount / 100}
                      onChange={(event) => setAutoRefillAmount(Math.max(MIN_TOP_UP_CENTS, Math.round(Number(event.target.value || '0') * 100)))}
                      disabled={!cardReady || busyAction !== null}
                    />
                  </label>
                )}
              </div>

              <div className="dev-inline-actions">
                <button
                  type="button"
                  className="dev-button dev-button--primary dev-button--stripe"
                  onClick={() => {
                    void handleTopUp()
                  }}
                  disabled={!cardReady || busyAction !== null}
                >
                  {busyAction === 'top-up' ? 'Funding...' : `Fund ${centsToUsd(topUpAmount)}`}
                </button>
              </div>

              {!cardReady && <p className="dev-inline-note">Add a card in Stripe first, then fund the account.</p>}
            </section>
          </div>
        )}
      </div>
    </section>
  )
}
