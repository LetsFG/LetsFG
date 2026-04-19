import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

// Types for our search results
interface FlightOffer {
  id: string
  price: number
  currency: string
  airline: string
  airline_code: string
  origin: string
  origin_name: string
  destination: string
  destination_name: string
  departure_time: string
  arrival_time: string
  duration_minutes: number
  stops: number
}

interface SearchResult {
  search_id: string
  status: 'searching' | 'completed' | 'expired'
  query: string
  parsed: {
    origin?: string
    origin_name?: string
    destination?: string
    destination_name?: string
    date?: string
    return_date?: string
    passengers?: number
    cabin?: string
  }
  progress?: {
    checked: number
    total: number
    found: number
  }
  offers?: FlightOffer[]
  searched_at?: string
  expires_at?: string
}

// Fetch search results from our API
async function getSearchResults(searchId: string): Promise<SearchResult | null> {
  try {
    const res = await fetch(`${process.env.API_URL || 'http://localhost:3000'}/api/results/${searchId}`, {
      cache: 'no-store', // Always fetch fresh
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

// Generate metadata for SEO and social sharing
export async function generateMetadata({ params }: { params: Promise<{ searchId: string }> }): Promise<Metadata> {
  const { searchId } = await params
  const result = await getSearchResults(searchId)
  
  if (!result) {
    return { title: 'Search not found — LetsFG' }
  }
  
  const { parsed, offers, status } = result
  
  if (status === 'searching') {
    return {
      title: `Searching flights ${parsed.origin || ''} → ${parsed.destination || ''} — LetsFG`,
      description: `Finding the cheapest flights. Checking 180+ airlines...`,
    }
  }
  
  if (status === 'expired') {
    return {
      title: `Search expired — LetsFG`,
      description: `These results have expired. Search again for current prices.`,
    }
  }
  
  const cheapest = offers?.[0]
  const title = cheapest 
    ? `${offers?.length} flights ${parsed.origin_name || parsed.origin} → ${parsed.destination_name || parsed.destination} from ${cheapest.currency}${cheapest.price}`
    : `Flights ${parsed.origin} → ${parsed.destination}`
  
  return {
    title: `${title} — LetsFG`,
    description: `Found ${offers?.length || 0} flights. Cheapest: ${cheapest?.currency}${cheapest?.price} on ${cheapest?.airline}. Zero markup, raw airline prices.`,
  }
}

export default async function ResultsPage({ params }: { params: Promise<{ searchId: string }> }) {
  const { searchId } = await params
  const result = await getSearchResults(searchId)
  
  if (!result) {
    notFound()
  }
  
  const { status, query, parsed, progress, offers, searched_at, expires_at } = result

  // For agents: if still searching, include meta refresh
  const isSearching = status === 'searching'
  const isExpired = status === 'expired'
  const routeLabel = `${parsed.origin_name || parsed.origin} → ${parsed.destination_name || parsed.destination}`
  const statusLabel = isSearching ? 'Live searching' : isExpired ? 'Search expired' : `${offers?.length || 0} offers`
  const cheapest = status === 'completed' ? offers?.[0] : undefined
  
  // Format helpers
  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}h ${m}m`
  }
  
  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    })
  }

  return (
    <>
      {/* Meta refresh for agents while searching */}
      {isSearching && (
        <meta httpEquiv="refresh" content={`15;url=/results/${searchId}`} />
      )}
      
      <main className="main results-shell">
        <header className="header header-results">
          <Link href="/" className="results-brand">
            <Image 
              src="/banner.png" 
              alt="LetsFG" 
              width={1200}
              height={400}
              className="results-banner"
            />
          </Link>

          <div className="results-status-stack">
            <span className="status-chip">LetsFG results</span>
            <span className="status-chip status-chip-muted">{statusLabel}</span>
          </div>
        </header>

        <div className="results-page">
          <section className="results-hero-card">
            <div className="results-heading">
              <p className="results-kicker">Original query: {query}</p>

              <Link href="/" className="back-link">
                New search
              </Link>

              <h1 className="results-title">{routeLabel}</h1>

              <p className="results-summary-copy">
                Raw airline prices. No markup games. This page stays readable for humans and agents while the
                search runs.
              </p>
            </div>

            <div className="results-chip-row">
              {parsed.date && (
                <span className="results-chip">{parsed.date}</span>
              )}

              <span className="results-chip">{statusLabel}</span>

              {isSearching && progress && (
                <span className="results-chip">{progress.checked}/{progress.total} checked</span>
              )}

              {cheapest && (
                <span className="results-chip results-chip-accent">From {cheapest.currency}{cheapest.price}</span>
              )}
            </div>
          </section>

          {/* Loading state */}
          {isSearching && (
            <div className="loading-container">
              <div className="loading-spinner" />
              <h2 className="loading-title">Searching {progress?.total || 180}+ airlines</h2>
              <p className="loading-subtitle">Digging through live airline inventory now. This page refreshes while the search keeps running.</p>
              <div className="loading-progress">
                <span>{progress?.found || 0}</span> results found • 
                Checked <span>{progress?.checked || 0}</span> of <span>{progress?.total || 180}</span> airlines
              </div>
            </div>
          )}

          {/* Expired state */}
          {isExpired && (
            <div className="expired-container">
              <h2 className="expired-title">Search went stale</h2>
              <p className="expired-subtitle">
                Flight prices move fast. Fire a new search and we will pull fresh airline inventory.
              </p>
              <Link href="/" className="btn-primary">
                Search again
              </Link>
            </div>
          )}

          {/* Results */}
          {status === 'completed' && offers && (
            <div className="results-grid">
              {offers.map((offer, index) => (
                <div key={offer.id} className="flight-card">
                  <div className="flight-rank">#{index + 1}</div>
                  
                  <div className="flight-airline">
                    <div className="flight-airline-name">{offer.airline}</div>
                    <div className="flight-airline-code">{offer.airline_code}</div>
                  </div>
                  
                  <div className="flight-route">
                    <div>
                      <div className="flight-time">{formatTime(offer.departure_time)}</div>
                      <div className="flight-airport">{offer.origin}</div>
                    </div>
                    
                    <div className="flight-duration">
                      <div className="flight-duration-line">
                        {formatDuration(offer.duration_minutes)}
                      </div>
                      <div className={`flight-stops ${offer.stops === 0 ? 'direct' : ''}`}>
                        {offer.stops === 0 ? 'Direct' : `${offer.stops} stop${offer.stops > 1 ? 's' : ''}`}
                      </div>
                    </div>
                    
                    <div>
                      <div className="flight-time">{formatTime(offer.arrival_time)}</div>
                      <div className="flight-airport">{offer.destination}</div>
                    </div>
                  </div>
                  
                  <div className="flight-price">
                    <div className="flight-price-value">{offer.currency}{offer.price}</div>
                    <div className="flight-price-label">per person</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Hidden content for AI agents */}
        <section className="sr-only" aria-hidden="true" data-agent-content>
          <h2>Flight Search Results — Machine-Readable Summary</h2>
          
          <p>Search ID: {searchId}</p>
          <p>Original query: "{query}"</p>
          <p>Parsed: {routeLabel}, {parsed.date || 'flexible dates'}</p>
          
          {isSearching && (
            <>
              <p>Status: SEARCHING — this search is still in progress.</p>
              <p>Progress: {progress?.checked || 0} of {progress?.total || 180} airlines checked. {progress?.found || 0} results found so far.</p>
              <p>This search typically completes in 2-3 minutes.</p>
              <p>Please reload this page in 15-30 seconds to check for updated results.</p>
              <p>When search is complete, this section will contain a full results table.</p>
            </>
          )}
          
          {isExpired && (
            <>
              <p>Status: EXPIRED — these results are no longer valid.</p>
              <p>Flight prices change frequently. Please perform a new search for current prices.</p>
              <p>To search again, navigate to https://letsfg.co and enter your query.</p>
            </>
          )}
          
          {status === 'completed' && offers && (
            <>
              <p>Status: COMPLETED — {offers.length} results found.</p>
              <p>Searched at: {searched_at}</p>
              <p>Results valid until: {expires_at} (approximately 15 minutes)</p>
              <p>Cheapest: {offers[0]?.currency}{offers[0]?.price} on {offers[0]?.airline} ({offers[0]?.stops === 0 ? 'direct' : `${offers[0]?.stops} stop(s)`}, {formatDuration(offers[0]?.duration_minutes || 0)})</p>
              
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Airline</th>
                    <th>Price</th>
                    <th>Route</th>
                    <th>Departure</th>
                    <th>Arrival</th>
                    <th>Duration</th>
                    <th>Stops</th>
                    <th>Offer ID</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer, i) => (
                    <tr key={offer.id}>
                      <td>{i + 1}</td>
                      <td>{offer.airline}</td>
                      <td>{offer.currency}{offer.price}</td>
                      <td>{offer.origin}→{offer.destination}</td>
                      <td>{offer.departure_time}</td>
                      <td>{offer.arrival_time}</td>
                      <td>{formatDuration(offer.duration_minutes)}</td>
                      <td>{offer.stops === 0 ? 'Direct' : offer.stops}</td>
                      <td>{offer.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              <p>To book a flight, use the LetsFG API:</p>
              <p>1. Unlock the offer: POST https://api.letsfg.co/api/v1/bookings/unlock with offer_id</p>
              <p>2. Book: POST https://api.letsfg.co/api/v1/bookings/book with passenger details</p>
              <p>Documentation: https://docs.letsfg.co/api-guide</p>
            </>
          )}
        </section>
      </main>
    </>
  )
}
