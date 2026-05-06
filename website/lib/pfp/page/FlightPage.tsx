/**
 * FlightPage.tsx — BOFU page template for a single directional flight route.
 *
 * Framework: every layout decision asks "does this move the user toward the
 * search CTA?" The CTA is the first interactive element in DOM tab order and
 * must be fully visible above the fold at 375px viewport.
 *
 * Sections (top to bottom):
 *  1. SEO HEAD (placeholder — metadata exported separately for Next.js App Router)
 *  2. HERO — H1 + TLDR + stats row + PRIMARY CTA + banners
 *  3. PRICE DISTRIBUTION — histogram (high/medium) or range bar (low)
 *  4. HIDDEN FEES — fee table (when available) + variance insight
 *  5. CARRIER COMPARISON — guarded: >= 2 carriers
 *  6. CONNECTOR COMPARISON — guarded: >= 2 connectors
 *  7. KEY FACTS — 3 self-contained GEO sentences
 *  8. FAQ — 5 dynamic questions with real data values
 *  9. SECONDARY CTA — search link + share button + social proof
 * 10. SNAPSHOT HISTORY — collapsible <details>
 */

import type { ReactNode } from 'react'
import type { RouteDistributionData, HistogramBucket } from '../types/route-distribution.types.ts'

// ─── Public types ─────────────────────────────────────────────────────────────

export type ExperimentVariant = 'A' | 'B' | 'C'

export interface FlightPageProps {
  data: RouteDistributionData
  experimentVariant?: ExperimentVariant
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FlightPage({ data, experimentVariant = 'A' }: FlightPageProps) {
  const {
    origin_iata, dest_iata, origin_city, dest_city,
    snapshot_computed_at, staleness, data_confidence,
    total_offers_analyzed, session_count,
    price_distribution, fee_analysis, carrier_summary, connector_comparison,
    tldr, page_status,
  } = data

  const snapshotDate = snapshot_computed_at.slice(0, 10)
  const currency = price_distribution.currency

  const ctaHref = `/search?origin=${origin_iata}&dest=${dest_iata}`

  const ctaText =
    experimentVariant === 'B' ? 'Expose hidden fees on your search →' :
    experimentVariant === 'C' ? `Search across ${carrier_summary.length} airlines →` :
    `Search ${origin_city} → ${dest_city} — see your price →`

  const shareUrl = `/flights/${origin_iata.toLowerCase()}-${dest_iata.toLowerCase()}?utm_source=share&utm_medium=flightpage`

  // Cheapest connector is first (already sorted asc by price_p50)
  const cheapestConnector = connector_comparison[0] ?? null

  const faqItems = buildFaqItems(data)

  const isNoindex = page_status === 'noindex' || page_status === 'archived'

  return (
    <article data-testid="flight-page" itemScope itemType="https://schema.org/Article">
      {/* Noindex marker — renders into SSR output; App Router generateMetadata also handles <head> */}
      {isNoindex && (
        <meta
          name="robots"
          content="noindex,nofollow"
          data-testid="noindex-meta"
        />
      )}

      {/* ── 2. HERO ───────────────────────────────────────────────────────── */}
      <section data-testid="hero" aria-labelledby="pfp-h1">
        <h1 data-testid="page-h1" id="pfp-h1">
          Flights {origin_city} → {dest_city}
        </h1>

        {/* TLDR — first text element after H1 */}
        <p className="tldr-summary" data-testid="tldr-summary">{buildTldrText(data)}</p>

        {/* Stats row — contains only <span>, no interactive elements */}
        <div data-testid="stats-row" aria-label="Route statistics">
          <span data-testid="offer-count-chip">
            {total_offers_analyzed} offers
          </span>

          {experimentVariant === 'A' && (
            <span data-testid="hero-stat-price-range">
              {fee_analysis.avg_hidden_fees_amount != null
                ? `avg ${currency} ${Math.round(fee_analysis.avg_hidden_fees_amount)} in fees`
                : 'Fee data varies by carrier'}
            </span>
          )}

          {experimentVariant === 'B' && (
            <span data-testid="hero-stat-fees">
              {fee_analysis.avg_hidden_fees_pct != null
                ? `~${Math.round(fee_analysis.avg_hidden_fees_pct * 100)}% fees`
                : 'Fee data varies by carrier'}
            </span>
          )}

          {experimentVariant === 'C' && (
            <span data-testid="hero-stat-carrier-count">
              {carrier_summary.length} airlines
            </span>
          )}

          <span data-testid="staleness-badge">
            {_fmtStalenessLabel(staleness, snapshot_computed_at)}
          </span>
        </div>

        {/* PRIMARY CTA — first interactive element in DOM */}
        <a
          data-testid="primary-cta"
          href={ctaHref}
          role="button"
          aria-label={`Search flights from ${origin_city} to ${dest_city}`}
        >
          {ctaText}
        </a>

        <p data-testid="disclaimer">
          Preview snapshot — prices change. Search for live results.
        </p>

        <p data-testid="eeeat-attribution">
          <small>
            Data collected by{' '}
            <a href="/flights/methodology/">LetsFG&apos;s multi-connector search system</a>
            {' '}— 180+ airline connectors searched in parallel.{' '}
            <a href="/flights/methodology/">How we collect data →</a>
          </small>
        </p>

        {staleness === 'stale' && (
          <div data-testid="stale-warning" role="alert">
            <strong>This data is over 7 days old.</strong>{' '}
            Prices on this route may have changed significantly.
            Run a live search for current fares.
          </div>
        )}

        {price_distribution.is_bimodal && (
          <div data-testid="bimodal-banner" role="note">
            {price_distribution.bimodal_insight ??
              'Two distinct fare clusters detected on this route — budget and premium options are clearly separated.'}
          </div>
        )}
      </section>

      {/* ── 3. PRICE DISTRIBUTION ─────────────────────────────────────────── */}
      <section data-testid="price-distribution-section" aria-labelledby="price-dist-h2">
        <h2 id="price-dist-h2">
          How much do flights from {origin_city} to {dest_city} cost?
        </h2>
        <p data-testid="dist-section-subhead">
          <small>Based on {total_offers_analyzed} offers · {_fmtMonthYear(snapshot_computed_at)}</small>
        </p>
        <p data-testid="dist-section-intro">
          {origin_city} to {dest_city} flights ranged from {currency}&nbsp;{Math.round(price_distribution.min)} to
          {' '}{currency}&nbsp;{Math.round(price_distribution.max)} across {total_offers_analyzed} offers
          analyzed in {_fmtMonthYear(snapshot_computed_at)}.
          {price_distribution.is_bimodal && ` ${price_distribution.bimodal_insight ?? 'Two distinct fare clusters are visible in the data.'}`}
          {' '}The chart below shows how prices distributed across all {total_offers_analyzed} offers.
        </p>

        {(data_confidence === 'high' || data_confidence === 'medium') && (
          <div data-testid="price-histogram" aria-label="Price distribution histogram">
            <HistogramChart histogram={price_distribution.histogram} currency={currency} />
            <div data-testid="percentile-markers">
              <span data-marker="p10">P10: {currency} {Math.round(price_distribution.p10)}</span>
              <span data-marker="p25">P25: {currency} {Math.round(price_distribution.p25)}</span>
              <span data-marker="p50">P50: {currency} {Math.round(price_distribution.p50)}</span>
              <span data-marker="p75">P75: {currency} {Math.round(price_distribution.p75)}</span>
              <span data-marker="p90">P90: {currency} {Math.round(price_distribution.p90)}</span>
            </div>
            <p data-testid="date-variable-note">
              These {total_offers_analyzed} offers ({_fmtMonthYear(snapshot_computed_at)}) span multiple departure dates and booking windows — your travel dates may fall anywhere in this distribution. Only a live search shows where your specific trip lands.
            </p>
            <p>
              50% of offers priced between{' '}
              {currency} {Math.round(price_distribution.p25)} and{' '}
              {currency} {Math.round(price_distribution.p75)}
            </p>
          </div>
        )}

        {data_confidence === 'low' && (
          <>
            <div data-testid="low-confidence-warning" role="alert">
              <strong>Limited data ({total_offers_analyzed} offers).</strong>{' '}
              Results may not fully represent the market. Run a search for more complete data.
            </div>
            <div
              data-testid="price-range-bar"
              aria-label={`Price range: ${currency} ${Math.round(price_distribution.min)} to ${currency} ${Math.round(price_distribution.max)}`}
            >
              <span data-marker="min">{currency} {Math.round(price_distribution.min)}</span>
              <span data-marker="p50">median {currency} {Math.round(price_distribution.p50)}</span>
              <span data-marker="max">{currency} {Math.round(price_distribution.max)}</span>
            </div>
          </>
        )}
      </section>

      {/* ── 4. HIDDEN FEES BREAKDOWN ──────────────────────────────────────── */}
      <section data-testid="fee-analysis-section" aria-labelledby="fee-h2">
        <h2 id="fee-h2">What hidden fees do {origin_city} to {dest_city} flights charge?</h2>

        <p data-testid="fee-section-intro">
          Ancillary fees — bags, seat selection, and payment surcharges — can add 10–25% to the base fare on {origin_city} to {dest_city} routes. The breakdown below is based on {total_offers_analyzed} offers analyzed in {_fmtMonthYear(snapshot_computed_at)}.
        </p>

        {fee_analysis.fee_breakdown_available && fee_analysis.breakdown && (
          <table data-testid="fee-breakdown-table">
            <caption>Ancillary fee breakdown by carrier</caption>
            <thead>
              <tr>
                <th scope="col">Carrier</th>
                <th scope="col">Avg fee ({currency})</th>
                <th scope="col">% of base fare</th>
              </tr>
            </thead>
            <tbody>
              {fee_analysis.breakdown.map((item) => (
                <tr key={item.carrier}>
                  <td>{item.carrier}</td>
                  <td>{Math.round(item.avg_fee)}</td>
                  <td>{Math.round(item.avg_fee_pct * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {fee_analysis.fee_breakdown_available && fee_analysis.avg_hidden_fees_amount != null && (() => {
            // Find the carrier pair where fees most meaningfully narrow the base-fare gap.
            // base = total - fee; narrowing = |base_gap| - |total_gap|  (positive = fees narrow the gap)
            const withFees = carrier_summary.filter(c => c.hidden_fees_avg != null && (c.hidden_fees_avg ?? 0) > 0)

            let bestNarrowing = -Infinity
            let highFeeCarrier: (typeof withFees)[0] | undefined
            let lowFeeCarrier: (typeof withFees)[0] | undefined

            for (let i = 0; i < withFees.length; i++) {
              for (let j = i + 1; j < withFees.length; j++) {
                const a = withFees[i]!
                const b = withFees[j]!
                const aBase = a.price_p50 - (a.hidden_fees_avg ?? 0)
                const bBase = b.price_p50 - (b.hidden_fees_avg ?? 0)
                const baseGap = Math.abs(aBase - bBase)
                const totalGap = Math.abs(a.price_p50 - b.price_p50)
                const narrowing = baseGap - totalGap
                if (narrowing > bestNarrowing) {
                  bestNarrowing = narrowing
                  if ((a.hidden_fees_avg ?? 0) >= (b.hidden_fees_avg ?? 0)) {
                    highFeeCarrier = a; lowFeeCarrier = b
                  } else {
                    highFeeCarrier = b; lowFeeCarrier = a
                  }
                }
              }
            }

            // Fall back to fee_analysis.breakdown if carrier_summary has no fee pairs
            if ((!highFeeCarrier || !lowFeeCarrier || highFeeCarrier === lowFeeCarrier) && fee_analysis.breakdown && fee_analysis.breakdown.length >= 2) {
              const bSorted = [...fee_analysis.breakdown].filter(b => b.avg_fee > 0).sort((a, b) => a.avg_fee - b.avg_fee)
              const bMin = bSorted[0]!
              const bMax = bSorted[bSorted.length - 1]!
              const minTotal = carrier_summary.find(c => c.carrier === bMin.carrier)?.price_p50 ?? price_distribution.p50
              const maxTotal = carrier_summary.find(c => c.carrier === bMax.carrier)?.price_p50 ?? price_distribution.p50
              const aBase = Math.round(minTotal - bMin.avg_fee)
              const aFee = Math.round(bMin.avg_fee)
              const aTotal = Math.round(minTotal)
              const bBase = Math.round(maxTotal - bMax.avg_fee)
              const bFee = Math.round(bMax.avg_fee)
              const bTotalRnd = Math.round(maxTotal)
              return (
                <>
                  <p data-testid="total-cost-callout">
                    <strong>{_getCarrierDisplayName(bMax.carrier)}:</strong> base ~{currency} {bBase} + fees {currency} {bFee} = ~{currency} {bTotalRnd} total.{' '}
                    <strong>{_getCarrierDisplayName(bMin.carrier)}:</strong> base ~{currency} {aBase} + fees {currency} {aFee} = ~{currency} {aTotal} total.
                  </p>
                  <p data-testid="total-cost-reversal-note">
                    {_getCarrierDisplayName(bMax.carrier)} carries {currency} {bFee - aFee} more in ancillary fees than {_getCarrierDisplayName(bMin.carrier)} — always compare total cost to see the full price gap between carriers.
                  </p>
                  <small data-testid="total-cost-estimate-note">Estimates based on median total minus average ancillary fee. Actual base fares vary by itinerary.</small>
                </>
              )
            }

            if (highFeeCarrier && lowFeeCarrier && highFeeCarrier !== lowFeeCarrier) {
              const hTotal = Math.round(highFeeCarrier.price_p50)
              const hFee = Math.round(highFeeCarrier.hidden_fees_avg!)
              const hBase = hTotal - hFee
              const lTotal = Math.round(lowFeeCarrier.price_p50)
              const lFee = Math.round(lowFeeCarrier.hidden_fees_avg!)
              const lBase = lTotal - lFee
              const baseGapFinal = Math.abs(hBase - lBase)
              const totalGapFinal = Math.abs(hTotal - lTotal)
              const narrowingPositive = bestNarrowing > 0
              return (
                <>
                  <p data-testid="total-cost-callout">
                    <strong>{_getCarrierDisplayName(highFeeCarrier.carrier)}:</strong> base ~{currency} {hBase} + fees {currency} {hFee} = ~{currency} {hTotal} total.{' '}
                    <strong>{_getCarrierDisplayName(lowFeeCarrier.carrier)}:</strong> base ~{currency} {lBase} + fees {currency} {lFee} = ~{currency} {lTotal} total.
                  </p>
                  <p data-testid="total-cost-reversal-note">
                    {narrowingPositive
                      ? `${_getCarrierDisplayName(highFeeCarrier.carrier)}'s ${currency} ${hFee} ancillary fees narrow the gap with ${_getCarrierDisplayName(lowFeeCarrier.carrier)}'s lower-fee model — the ${currency} ${baseGapFinal} base difference shrinks to ${currency} ${totalGapFinal} after fees.`
                      : `Total costs diverge further when fees are added on this route.`
                    }{' '}Always compare total cost, not just the advertised base fare.
                  </p>
                  <small data-testid="total-cost-estimate-note">Estimates based on median total minus average ancillary fee. Actual base fares vary by itinerary.</small>
                </>
              )
            }
            return (
              <>
                <p data-testid="total-cost-callout">
                  Add {currency}&nbsp;{Math.round(fee_analysis.avg_hidden_fees_amount)} in average fees to base fare to get the true total cost of your ticket.
                </p>
                <p data-testid="total-cost-reversal-note">
                  Run a live search to see the total-cost breakdown for your specific itinerary — fees vary by bag allowance, seat selection, and payment method.
                </p>
              </>
            )
          })()}

        {!fee_analysis.fee_breakdown_available && (
          <p data-testid="fee-no-data">
            Most connectors did not expose itemized fee data on this route.
            Run your search to see fees for your specific itinerary.
          </p>
        )}

        <p data-testid="fee-variance-insight">
          {fee_analysis.fee_variance === 'high'
            ? `Fee levels vary significantly across carriers on this route — some carriers charge 50%+ above the base fare in ancillary fees.`
            : fee_analysis.fee_variance === 'medium'
            ? (() => {
                if (fee_analysis.breakdown && fee_analysis.breakdown.length >= 2) {
                  const sorted = [...fee_analysis.breakdown].filter(b => b.avg_fee > 0).sort((a, b) => b.avg_fee - a.avg_fee)
                  const maxCarrier = sorted[0]
                  const minCarrier = sorted[sorted.length - 1]
                  if (maxCarrier && minCarrier && maxCarrier !== minCarrier) {
                    const ratio = minCarrier.avg_fee > 0 ? (maxCarrier.avg_fee / minCarrier.avg_fee).toFixed(1) : null
                    return ratio
                      ? `${maxCarrier.carrier} charges ${ratio}x more in ancillary fees than ${minCarrier.carrier} on this route. Compare total-cost options when booking.`
                      : `Fee levels vary across carriers on this route. Compare total-cost options when booking.`
                  }
                }
                return `Fee levels vary across carriers on this route. Compare total-cost options when booking.`
              })()
            : `Fee levels are relatively consistent across carriers on this route.`}
        </p>

        <a
          href={`/search?origin=${origin_iata}&dest=${dest_iata}&show_fees=1`}
          data-testid="fee-search-cta"
        >
          Run your search to see itemized fees for your itinerary
        </a>
      </section>

      {/* ── 5. CARRIER COMPARISON (guard: >= 2 carriers) ──────────────────── */}
      {carrier_summary.length >= 2 && (
        <section data-testid="carrier-comparison-section" aria-labelledby="carrier-h2">
          <h2 id="carrier-h2">Which airline is cheapest from {origin_city} to {dest_city}?</h2>
          <p data-testid="carrier-section-intro">
            {carrier_summary.length} airline{carrier_summary.length !== 1 ? 's' : ''} operated {origin_city} to {dest_city} routes in this dataset.
            {price_distribution.is_bimodal && ' The route shows a clear split between low-cost and full-service carriers.'}
            {' '}Median prices below include all fees captured by our agents.
          </p>
          <table data-testid="carrier-table">
            <thead>
              <tr>
                <th scope="col">Airline</th>
                <th scope="col">Offers</th>
                <th scope="col">Median ({currency})</th>
                <th scope="col">Avg fees ({currency})</th>
                <th scope="col">Fees %</th>
              </tr>
            </thead>
            <tbody>
              {carrier_summary.map((c) => (
                <tr key={c.carrier}>
                  <td>
                    {c.carrier}
                  </td>
                  <td>{c.offer_count}</td>
                  <td>{Math.round(c.price_p50)}</td>
                  <td>{c.hidden_fees_avg != null ? Math.round(c.hidden_fees_avg) : <span title="Fee data not available">n/a</span>}</td>
                  <td>{c.hidden_fees_pct != null ? `${Math.round(c.hidden_fees_pct * 100)}%` : <span title="Fee data not available">n/a</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── 6. CONNECTOR COMPARISON (guard: >= 2 connectors) ──────────────── */}
      {connector_comparison.length >= 2 && (
        <section data-testid="connector-comparison-section" aria-labelledby="connector-h2">
          <h2 id="connector-h2">Where did our agents find the best prices?</h2>

          {cheapestConnector !== null && (() => {
            const mostExpensive = connector_comparison[connector_comparison.length - 1]!
            const spread = Math.round(mostExpensive.price_p50 - cheapestConnector.price_p50)
            const topVolumeConnector = [...connector_comparison].sort((a, b) => b.offer_count - a.offer_count)[0]!
            return (
              <p data-testid="connector-insight">
                Across all {connector_comparison.length} connectors, prices ranged {currency} {spread} from lowest to highest median.{' '}
                <strong>{topVolumeConnector.display_name}</strong> had the most offers, but{' '}
                <strong>{cheapestConnector.display_name}</strong> had the best median price — a gap you'd only find searching all connectors simultaneously.
              </p>
            )
          })()}

          <table data-testid="connector-table" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th scope="col">Connector</th>
                <th scope="col">Type</th>
                <th scope="col">Offers</th>
                <th scope="col">Median ({currency})</th>
                <th scope="col">vs group avg</th>
              </tr>
            </thead>
            <tbody>
              {connector_comparison.map((c) => (
                <tr key={c.connector_name}>
                  <td>{c.display_name}</td>
                  <td>{_connectorTypeLabel(c.carrier_coverage_type)}</td>
                  <td>{c.offer_count}</td>
                  <td>{Math.round(c.price_p50)}</td>
                  <td>{c.delta_vs_avg_pct > 0 ? '+' : ''}{Math.round(c.delta_vs_avg_pct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p data-testid="connector-group-note">
            <small>* &ldquo;vs group avg&rdquo; compares each connector against the average median of its type: Direct connectors vs Direct average, Meta connectors vs Meta average.</small>
          </p>
          <p data-testid="connector-data-note">
            <small>Connector names represent LetsFG&apos;s own search agents and do not constitute affiliation with or endorsement by named providers. Data reflects prices captured by LetsFG connectors — not official data from those platforms.</small>
          </p>
        </section>
      )}

      {/* ── 7. KEY FACTS ────────────────────────────────────────────────────── */}
      <section data-testid="key-facts-section" aria-labelledby="key-facts-h2">
        <h2 id="key-facts-h2">Key facts: {origin_city} to {dest_city} flights</h2>
        <ul data-testid="key-facts-list">
          {buildKeyFacts(data).map((fact, i) => (
            <li key={i} data-testid={`key-fact-${i}`}>{fact}</li>
          ))}
        </ul>
      </section>

      {/* ── 8. RELATED ROUTES (internal linking, only when data is provided) ── */}
      {data.related_routes && data.related_routes.length > 0 && (
        <nav data-testid="related-routes-section" aria-label={`More flights from ${origin_city}`}>
          <h2 id="related-routes-h2">More flights from {origin_city}</h2>
          <ul data-testid="related-routes-list">
            {data.related_routes.map((r) => {
              const slug = `${r.origin_iata.toLowerCase()}-${r.dest_iata.toLowerCase()}`
              return (
                <li key={slug}>
                  <a href={`/flights/${slug}/`} data-testid={`related-route-${slug}`}>
                    {r.origin_city} → {r.dest_city}
                    {r.median_price != null && r.currency != null && (
                      <> — from {r.currency} {Math.round(r.median_price)}</>
                    )}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>
      )}

      {/* ── 9. FAQ ──────────────────────────────────────────────────────────── */}
      <section data-testid="faq-section" aria-labelledby="faq-h2">
        <h2 id="faq-h2">Frequently asked questions</h2>
        <dl>
          {faqItems.map((item, i) => (
            <div key={i} data-testid={`faq-item-${i}`}>
              <dt data-testid={`faq-q-${i}`}>{item.q}</dt>
              <dd data-testid={`faq-a-${i}`}>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── 10. SECONDARY CTA BLOCK ──────────────────────────────────────────── */}
      <section data-testid="secondary-cta-section" aria-labelledby="secondary-cta-h2">
        <h2 id="secondary-cta-h2">
          {price_distribution.is_bimodal
            ? `${carrier_summary.length} airlines, two price clusters — find which fits your budget`
            : `${carrier_summary.length} airlines compete on this route — our agents search them all`}
        </h2>

        <a
          data-testid="search-cta-secondary"
          href={`/search?origin=${origin_iata}&dest=${dest_iata}`}
        >
          Find flights for my dates
        </a>

        <button
          data-testid="share-button"
          type="button"
          data-share-url={shareUrl}
          aria-label="Share this page"
        >
          Share this page
        </button>

        <p data-testid="social-proof">
          {session_count >= 3
            ? `${total_offers_analyzed} offers analyzed for this route in ${_fmtMonthYear(snapshot_computed_at)}`
            : 'New route — be among the first to track this itinerary'}
        </p>
      </section>

      {/* ── 11. SNAPSHOT HISTORY (collapsible, default closed) ──────────────── */}
      {session_count >= 3 && (
        <section data-testid="snapshot-history-section" aria-labelledby="history-h2">
          <h2 id="history-h2">Search history for this route</h2>
          <details data-testid="snapshot-history">
            <summary>Snapshot history</summary>
            <p>
              Based on {session_count} search session{session_count !== 1 ? 's' : ''}. Showing most recent 5.{' '}
              Most recent: <time dateTime={snapshotDate}>{snapshotDate}</time>.
            </p>
            {data.session_history && data.session_history.length > 0 && (
              <>
                <table data-testid="session-history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Offers</th>
                      <th>Median ({currency})</th>
                      <th>Airlines</th>
                      <th>Connectors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.session_history.slice(0, 5).map((s) => (
                      <tr key={s.session_id}>
                        <td><time dateTime={s.captured_at.slice(0, 10)}>{s.captured_at.slice(0, 10)}</time></td>
                        <td>{s.total_offers}</td>
                        <td>{Math.round(s.median_price)}</td>
                        <td>{s.airline_count != null ? s.airline_count : <span title="Not available">—</span>}</td>
                        <td>{s.connector_count != null ? s.connector_count : <span title="Not available">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p><small>* "Connectors" = number of airline connectors and OTAs searched in that session. Sessions run as the route accumulates more data over time.</small></p>
              </>
            )}
            <p data-testid="snapshot-footer">
              Full price history and individual offer data available when you run your own agent search.
            </p>
          </details>
        </section>
      )}
    </article>
  )
}

// ─── TLDR text generator ─────────────────────────────────────────────────────

function buildTldrText(data: RouteDistributionData): string {
  const {
    origin_city, dest_city, total_offers_analyzed, carrier_summary,
    price_distribution, snapshot_computed_at,
  } = data
  const { currency, p10, p50, p90, min, max, is_bimodal } = price_distribution
  const monthYear = _fmtMonthYear(snapshot_computed_at)

  const lccCarriers = carrier_summary.filter(c => c.price_p50 < p50)
  const fscCarriers = carrier_summary.filter(c => c.price_p50 >= p50)
  const lccOfferCount = lccCarriers.reduce((s, c) => s + c.offer_count, 0)
  const lccPct = total_offers_analyzed > 0
    ? Math.round(lccOfferCount / total_offers_analyzed * 100) : 0

  const rangeClause = `typical range ${currency} ${Math.round(p10)}–${Math.round(p90)}, median ${currency} ${Math.round(p50)}`
  const fullRangeClause = `Full range across all ${total_offers_analyzed} offers: ${currency} ${Math.round(min)}–${Math.round(max)}.`

  if (is_bimodal && lccCarriers.length > 0 && fscCarriers.length > 0) {
    const lccMed = Math.round(lccCarriers[lccCarriers.length - 1]!.price_p50)
    const fscMed = Math.round(fscCarriers[0]!.price_p50)
    return `As of ${monthYear}, economy flights from ${origin_city} to ${dest_city} have a ${rangeClause}. ${fullRangeClause} Our AI agents found ${lccPct}% of ${total_offers_analyzed} offers from budget carriers (around ${currency} ${lccMed}) and ${100 - lccPct}% from full-service carriers (around ${currency} ${fscMed}).`
  }
  return `As of ${monthYear}, economy flights from ${origin_city} to ${dest_city} have a ${rangeClause}. ${fullRangeClause} Our AI agents analyzed ${total_offers_analyzed} offers from ${carrier_summary.length} airline${carrier_summary.length !== 1 ? 's' : ''} in a single search session.`
}

// ─── Key facts builder (data-driven, not editorial) ──────────────────────────

export function buildKeyFacts(data: RouteDistributionData): string[] {
  const { origin_city, dest_city, price_distribution, fee_analysis,
    carrier_summary, connector_comparison, total_offers_analyzed } = data
  const { currency, p50 } = price_distribution

  // Fact 0: LCC vs FSC ratio
  const lccs = carrier_summary.filter(c => _isLcc(c.carrier))
  const fscs = carrier_summary.filter(c => !_isLcc(c.carrier))
  let fact0: string
  if (lccs.length > 0 && fscs.length > 0) {
    const lccMedian = lccs.reduce((sum, c) => sum + c.price_p50, 0) / lccs.length
    const fscMedian = fscs.reduce((sum, c) => sum + c.price_p50, 0) / fscs.length
    const ratio = fscMedian > 0 ? (fscMedian / lccMedian).toFixed(1) : null
    fact0 = ratio
      ? `Full-service carriers on ${origin_city}–${dest_city} cost ${ratio}x more than budget airlines (${currency} ${Math.round(fscMedian)} vs ${currency} ${Math.round(lccMedian)} median; overall median ${currency} ${Math.round(p50)}).`
      : `${origin_city}–${dest_city} had ${total_offers_analyzed} offers analyzed. Median price: ${currency} ${Math.round(p50)}.`
  } else {
    fact0 = `${origin_city}–${dest_city} had ${total_offers_analyzed} offers analyzed. Median price: ${currency} ${Math.round(p50)}.`
  }

  // Fact 1: Fee spread with named carriers (when available), or generic fee stat
  let fact1: string
  if (fee_analysis.breakdown && fee_analysis.breakdown.length >= 2) {
    const sorted = [...fee_analysis.breakdown].filter(b => b.avg_fee > 0).sort((a, b) => b.avg_fee - a.avg_fee)
    const maxCarrier = sorted[0]
    const minCarrier = sorted[sorted.length - 1]
    if (maxCarrier && minCarrier && maxCarrier !== minCarrier) {
      const ratio = minCarrier.avg_fee > 0 ? (maxCarrier.avg_fee / minCarrier.avg_fee).toFixed(1) : null
      fact1 = ratio
        ? `${maxCarrier.carrier} charges ${ratio}x more in ancillary fees than ${minCarrier.carrier} — ${currency} ${Math.round(maxCarrier.avg_fee)} vs ${currency} ${Math.round(minCarrier.avg_fee)} avg per booking.`
        : `Fee levels vary across carriers — ${maxCarrier.carrier} and ${minCarrier.carrier} represent the extremes on this route.`
    } else {
      fact1 = fee_analysis.avg_hidden_fees_amount != null
        ? `Ancillary fees averaged ${currency} ${Math.round(fee_analysis.avg_hidden_fees_amount)} per offer on this route.`
        : `Most connectors did not expose itemized fee data on ${origin_city}–${dest_city}.`
    }
  } else if (fee_analysis.avg_hidden_fees_amount != null) {
    fact1 = `Ancillary fees averaged ${currency} ${Math.round(fee_analysis.avg_hidden_fees_amount)} per offer on this route${fee_analysis.avg_hidden_fees_pct != null ? ` — ${Math.round(fee_analysis.avg_hidden_fees_pct * 100)}% of the base fare` : ''}.`
  } else {
    fact1 = `Most connectors did not expose itemized fee data on ${origin_city}–${dest_city} in the last session.`
  }

  // Fact 2: Connector spread (max - min median) + count
  let fact2: string
  if (connector_comparison.length >= 2) {
    const sortedConn = [...connector_comparison].sort((a, b) => a.price_p50 - b.price_p50)
    const cheapConn = sortedConn[0]!
    const connPrices = connector_comparison.map(c => c.price_p50)
    const connMin = Math.min(...connPrices)
    const connMax = Math.max(...connPrices)
    const spread = Math.round(connMax - connMin)
    fact2 = `Across ${connector_comparison.length} connectors, prices span ${currency} ${spread} — ${cheapConn.display_name} had the lowest median at ${currency} ${Math.round(connMin)}. Searching all connectors simultaneously reveals the full picture.`
  } else {
    const cheapestCarrier = carrier_summary[0]
    fact2 = cheapestCarrier
      ? `Lowest-priced airline: ${_getCarrierDisplayName(cheapestCarrier.carrier)} at ${currency} ${Math.round(cheapestCarrier.price_p50)} median vs ${currency} ${Math.round(p50)} overall across ${carrier_summary.length} carriers.`
      : `${carrier_summary.length} airline${carrier_summary.length !== 1 ? 's' : ''} competed on this route in the dataset.`
  }

  return [fact0, fact1, fact2]
}

/** Returns true if the carrier is a low-cost carrier. */
function _isLcc(carrier: string): boolean {
  const LCC_IATA = new Set(['FR', 'W6', 'U2', 'VY', 'DY', 'F9', 'NK', 'WN', 'G4', 'B6', 'WS', 'PC', 'FZ'])
  const LCC_NAMES = ['Ryanair', 'Wizz Air', 'easyJet', 'Vueling', 'Norwegian', 'Frontier', 'Spirit',
    'Southwest', 'Allegiant', 'JetBlue', 'WestJet', 'Pegasus', 'flydubai', 'IndiGo', 'GoAir',
    'AirAsia', 'Cebu Pacific', 'VietJet', 'SpiceJet', 'Nok Air', 'Scoot', 'Tigerair']
  if (LCC_IATA.has(carrier)) return true
  return LCC_NAMES.some(name => carrier.toLowerCase().includes(name.toLowerCase()))
}

// ─── Carrier IATA code → display name ────────────────────────────────────────

const _CARRIER_NAMES: Record<string, string> = {
  FR: 'Ryanair', W6: 'Wizz Air', U2: 'easyJet', LO: 'LOT Polish Airlines',
  LH: 'Lufthansa', BA: 'British Airways', AA: 'American Airlines',
  DL: 'Delta Air Lines', UA: 'United Airlines', AF: 'Air France',
  KL: 'KLM', LX: 'Swiss International', OS: 'Austrian Airlines',
  TK: 'Turkish Airlines', EK: 'Emirates', QR: 'Qatar Airways',
  EY: 'Etihad Airways', SQ: 'Singapore Airlines', QF: 'Qantas',
  VS: 'Virgin Atlantic', AY: 'Finnair', IB: 'Iberia', VY: 'Vueling',
  TP: 'TAP Air Portugal', SK: 'SAS', DY: 'Norwegian',
  EW: 'Eurowings', G4: 'Allegiant Air', F9: 'Frontier Airlines',
  NK: 'Spirit Airlines', WN: 'Southwest Airlines', B6: 'JetBlue',
  AS: 'Alaska Airlines', AC: 'Air Canada', WS: 'WestJet',
  FZ: 'flydubai', G9: 'Air Arabia', PC: 'Pegasus Airlines',
}

function _getCarrierDisplayName(iata: string): string {
  return _CARRIER_NAMES[iata] ?? iata
}

/** Map carrier_coverage_type to a human-readable connector type label. */
function _connectorTypeLabel(type: string): string {
  if (type === 'budget_only' || type === 'carrier_specific') return 'Direct'
  if (type === 'mixed') return 'Meta'
  if (type === 'ota') return 'OTA'
  return type
}

/** Format ISO date as "Month YYYY" using UTC. */
function _fmtMonthYear(isoDate: string): string {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const d = new Date(isoDate)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Format staleness as human-readable badge label. */
function _fmtStalenessLabel(staleness: string, snapshotIso: string): string {
  const monthYear = _fmtMonthYear(snapshotIso)
  if (staleness === 'fresh') return `Fresh · ${monthYear}`
  const diffMs = Date.now() - new Date(snapshotIso).getTime()
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
  if (staleness === 'recent') return `Updated ${diffDays} day${diffDays !== 1 ? 's' : ''} ago`
  return `⚠ ${diffDays} day${diffDays !== 1 ? 's' : ''} old`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HistogramChart({
  histogram,
  currency,
}: {
  histogram: HistogramBucket[]
  currency: string
}) {
  const maxBucketPct = Math.max(...histogram.map((b) => b.pct), 1)
  return (
    <div
      data-testid="histogram-chart"
      role="img"
      aria-label={`Price histogram with ${histogram.length} buckets`}
    >
      {histogram.map((bucket, i) => (
        <div
          key={i}
          data-testid={`histogram-bucket-${i}`}
          aria-label={`${Math.round(bucket.pct)}% of offers: ${currency} ${Math.round(bucket.from)}–${Math.round(bucket.to)}`}
          data-pct={Math.round(bucket.pct)}
          style={{ height: `${Math.max((bucket.pct / maxBucketPct) * 100, 4)}%` }}
        >
          <span aria-hidden="true">{Math.round(bucket.from)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── FAQ builder ─────────────────────────────────────────────────────────────

export function buildFaqItems(data: RouteDistributionData): Array<{ q: string; a: ReactNode }> {
  const { origin_iata, dest_iata, origin_city, dest_city,
    price_distribution, fee_analysis, carrier_summary, connector_comparison,
    total_offers_analyzed } = data

  const currency = price_distribution.currency
  const cheapestCarrier = carrier_summary[0]
  const cheapestConnector = connector_comparison[0]
  const searchHref = `/search?origin=${origin_iata}&dest=${dest_iata}`

  return [
    {
      q: `How much does a flight from ${origin_city} to ${dest_city} cost?`,
      a: <>
        Based on {total_offers_analyzed} offers analyzed, {origin_city} to {dest_city} flights{' '}
        range from {currency} {Math.round(price_distribution.min)} to{' '}
        {currency} {Math.round(price_distribution.max)},{' '}
        with a median price of {currency} {Math.round(price_distribution.p50)}.{' '}
        <a href={searchHref}>Search for your specific dates →</a>
      </>,
    },
    {
      q: `What hidden fees should I expect on ${origin_city} to ${dest_city} flights?`,
      a: <>
        {fee_analysis.fee_breakdown_available && fee_analysis.avg_hidden_fees_amount != null
          ? `On average, ancillary fees (bags, seat selection) add ` +
            `${currency} ${Math.round(fee_analysis.avg_hidden_fees_amount)} to the base fare ` +
            `on ${origin_city} to ${dest_city} flights.`
          : `Fee data was not captured by most connectors on ${origin_city}–${dest_city}. ` +
            `Only ~15 of our 180+ connectors expose bag and seat pricing.`
        }{' '}<a href={`${searchHref}&show_fees=1`}>See itemized fees for your itinerary →</a>
      </>,
    },
    {
      q: `Which airline is cheapest on ${origin_city} to ${dest_city} including all fees?`,
      a: <>
        {cheapestCarrier
          ? `${_getCarrierDisplayName(cheapestCarrier.carrier)} has the lowest median fare on ${origin_city} to ${dest_city} ` +
            `at ${currency} ${Math.round(cheapestCarrier.price_p50)} ` +
            `(median across ${cheapestCarrier.offer_count} offers in our snapshot).`
          : `Carrier price data is not yet available for this route.`
        }{' '}<a href={searchHref}>Check which airline wins on your dates →</a>
      </>,
    },
    {
      q: `Which booking connector finds the best deals on ${origin_city}–${dest_city}?`,
      a: <>
        {cheapestConnector
          ? `Our ${cheapestConnector.display_name} search agent surfaced the lowest median prices ` +
            `on ${origin_city}–${dest_city} — ` +
            `${Math.abs(Math.round(cheapestConnector.delta_vs_avg_pct))}% below the average ` +
            `across all connectors we searched.`
          : `Connector comparison data is not yet available.`
        }{' '}<a href={searchHref}>Run a live multi-connector search →</a>
      </>,
    },
    {
      q: `Why do prices vary so much on ${origin_city} to ${dest_city} routes?`,
      a: <>
        {origin_city} to {dest_city} has {carrier_summary.length} airlines competing,{' '}
        creating a price range from {currency} {Math.round(price_distribution.min)}{' '}
        to {currency} {Math.round(price_distribution.max)} across {total_offers_analyzed} offers.
        {price_distribution.is_bimodal
          ? ` There are two distinct fare clusters on this route: budget options and premium fares.`
          : ` Prices on this route change with booking timing, advance purchase, and ancillary add-ons.`
        }{' '}<a href={searchHref}>Find where your trip lands in the distribution →</a>
      </>,
    },
  ]
}

/** Format ISO date as a human-readable relative string (e.g., "3 days ago"). */
function _fmtRelativeDate(isoDate: string): string {
  const now = new Date()
  const then = new Date(isoDate)
  const diffMs = now.getTime() - then.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  const diffWeeks = Math.floor(diffDays / 7)
  if (diffWeeks < 5) return `${diffWeeks} week${diffWeeks !== 1 ? 's' : ''} ago`
  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`
}
