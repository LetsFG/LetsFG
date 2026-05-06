/**
 * /[locale]/flights/methodology/page.tsx — Data methodology & E-E-A-T page.
 *
 * Explains how LetsFG collects flight price data, what the statistics mean,
 * and the limitations of the dataset. This page is a key E-E-A-T signal for
 * Google and LLMs that cite LetsFG data.
 */

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How We Collect Flight Price Data — Methodology | LetsFG',
  description:
    'LetsFG uses 180+ automated airline connectors to collect real-time flight prices. ' +
    'Learn how we search, deduplicate, and analyze offers — and what the percentile statistics mean.',
  openGraph: {
    title: 'Flight Data Methodology | LetsFG',
    description:
      'How LetsFG collects, processes, and publishes flight price statistics ' +
      'from 180+ airline connectors.',
    type: 'article',
    siteName: 'LetsFG',
  },
  twitter: {
    card: 'summary',
    title: 'Flight Data Methodology | LetsFG',
  },
  alternates: {
    canonical: 'https://letsfg.co/en/flights/methodology/',
  },
}

export default function FlightMethodologyPage() {
  return (
    <article
      itemScope
      itemType="https://schema.org/Article"
      data-testid="methodology-page"
    >
      <header>
        <h1 itemProp="headline">How We Collect Flight Price Data</h1>
        <p>
          <strong>Author:</strong>{' '}
          <span itemProp="author" itemScope itemType="https://schema.org/Organization">
            <span itemProp="name">LetsFG</span>
          </span>
          {' '}·{' '}
          <time itemProp="dateModified" dateTime="2026-05-05">May 2026</time>
        </p>
      </header>

      {/* ── 1. Overview ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="overview-h2">
        <h2 id="overview-h2">Overview</h2>
        <p>
          LetsFG operates an automated multi-connector search system that queries
          180+ airline websites, OTAs, and meta-search aggregators in parallel.
          Each search session fires all relevant connectors simultaneously, collects
          raw offers, deduplicates them, and records the full price distribution —
          not just the cheapest result.
        </p>
        <p>
          The statistics shown on flight route pages are computed from real offers
          retrieved by our connectors during recent search sessions. We do not adjust,
          inflate, or editorially curate prices. What you see is the mathematical
          distribution of raw offers as our agents captured them.
        </p>
      </section>

      {/* ── 2. How connectors work ───────────────────────────────────────────── */}
      <section aria-labelledby="connectors-h2">
        <h2 id="connectors-h2">How Our Connectors Work</h2>
        <p>
          Each connector is a purpose-built automation that queries a single
          airline or booking platform. We operate three connector patterns:
        </p>
        <ul>
          <li>
            <strong>Direct API connectors</strong> — reverse-engineered REST or
            GraphQL endpoints for airlines that expose structured pricing data
            (e.g. Ryanair, Wizz Air, Southwest). These are the fastest connectors,
            typically completing in 0.3–2 seconds.
          </li>
          <li>
            <strong>Browser automation connectors</strong> — real Chrome instances
            controlled via Playwright that navigate airline websites and capture
            rendered prices. Used for platforms that don&apos;t expose API endpoints.
            Typically 10–25 seconds per search.
          </li>
          <li>
            <strong>API interception connectors</strong> — Playwright-driven
            navigation that intercepts the network responses an airline website
            makes to its own backend. Captures structured price data without
            parsing HTML. Typically 5–15 seconds.
          </li>
        </ul>
        <p>
          All connectors run locally on the user&apos;s machine or our infrastructure —
          never on third-party cloud providers. This means prices are fetched
          directly from the airline&apos;s own systems, without intermediary caching or
          demand-based inflation.
        </p>
      </section>

      {/* ── 3. What the statistics mean ─────────────────────────────────────── */}
      <section aria-labelledby="statistics-h2">
        <h2 id="statistics-h2">What the Statistics Mean</h2>
        <dl>
          <div>
            <dt><strong>Median (P50)</strong></dt>
            <dd>
              The price at which exactly half of the captured offers are cheaper
              and half are more expensive. More robust than the average because it
              is not skewed by a few very cheap or very expensive outliers.
            </dd>
          </div>
          <div>
            <dt><strong>P10 / P25 / P75 / P90</strong></dt>
            <dd>
              Percentile prices. P10 means 10% of offers were cheaper than this
              price — it approximates the &quot;budget end&quot; of the market.
              P90 approximates the &quot;premium end&quot;. The P25–P75 range (IQR)
              is where 50% of offers fall.
            </dd>
          </div>
          <div>
            <dt><strong>Avg hidden fees</strong></dt>
            <dd>
              The average ancillary fee (bags, seat selection, payment surcharges)
              captured per offer by our connectors. Calculated as:
              total price observed by the connector minus the base fare advertised
              at the first step of the booking flow.
            </dd>
          </div>
          <div>
            <dt><strong>vs group avg</strong></dt>
            <dd>
              In the connector comparison table, each connector is benchmarked
              against the average median price of its own type: direct airline
              connectors vs other direct connectors; OTA/meta connectors vs other
              OTAs. This removes the natural price advantage of budget airlines
              accessed via direct connectors.
            </dd>
          </div>
          <div>
            <dt><strong>Offer count</strong></dt>
            <dd>
              The number of unique fare options (a combination of outbound flight,
              fare class, and cabin) captured by our connectors in a single search
              session. Higher counts mean more comprehensive coverage.
            </dd>
          </div>
        </dl>
      </section>

      {/* ── 4. Data freshness ────────────────────────────────────────────────── */}
      <section aria-labelledby="freshness-h2">
        <h2 id="freshness-h2">Data Freshness</h2>
        <p>
          Each route page displays a freshness label based on when the underlying
          snapshot was last updated:
        </p>
        <ul>
          <li><strong>Fresh</strong> — snapshot is less than 48 hours old</li>
          <li><strong>Recent</strong> — snapshot is 2–7 days old</li>
          <li><strong>Stale</strong> — snapshot is older than 7 days; prices may have changed significantly</li>
        </ul>
        <p>
          Flight prices change in real time. The distributions shown on these pages
          are <em>historical snapshots</em> that indicate what prices looked like
          when our agents last searched. They are not live quotes. Always run a
          live search to get current fares for your specific travel dates.
        </p>
      </section>

      {/* ── 5. Limitations ───────────────────────────────────────────────────── */}
      <section aria-labelledby="limitations-h2">
        <h2 id="limitations-h2">Limitations & Important Notes</h2>
        <ul>
          <li>
            <strong>Not a booking platform.</strong> LetsFG does not sell flights.
            Our data informs your search; you book directly with the airline or OTA.
          </li>
          <li>
            <strong>Connector coverage varies by route.</strong> Not all 180+
            connectors are relevant for every route. Our routing system fires only
            connectors with documented coverage for each origin–destination pair.
          </li>
          <li>
            <strong>Fee capture is best-effort.</strong> Ancillary fee data requires
            progressing further into the booking flow. Some connectors capture fees
            at the search result stage; others do not. Routes where fee data is
            unavailable are marked accordingly.
          </li>
          <li>
            <strong>Connector names are LetsFG agent names.</strong> When we refer
            to &quot;Ryanair (direct)&quot; or &quot;Skyscanner&quot; in connector comparison tables,
            these are the names of our own search agents — not official data from or
            affiliation with those companies. The data reflects what our connectors
            captured, not prices guaranteed by those platforms.
          </li>
          <li>
            <strong>Prices are point-in-time.</strong> A single search session
            captures prices for a specific search date and passenger count.
            Different search dates or passenger configurations will yield different
            distributions.
          </li>
        </ul>
      </section>

      {/* ── 6. About LetsFG ──────────────────────────────────────────────────── */}
      <section aria-labelledby="about-h2">
        <h2 id="about-h2">About LetsFG</h2>
        <p>
          LetsFG is an agent-native flight search toolkit. Our open-source
          connector library is available on{' '}
          <a href="https://github.com/LetsFG/LetsFG" rel="noopener">GitHub</a>
          {' '}and{' '}
          <a href="https://pypi.org/project/letsfg/" rel="noopener">PyPI</a>.
          AI agents, developers, and researchers can use our connectors to run
          their own multi-airline searches.
        </p>
        <p>
          Questions about our data methodology?{' '}
          <a href="mailto:hello@letsfg.co">hello@letsfg.co</a>
        </p>
      </section>
    </article>
  )
}
