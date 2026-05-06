/**
 * AgentSearchSession — normalized TypeScript interface for the output of one
 * LetsFG agent search session.
 *
 * A single session fires 180+ connectors in parallel and returns 15–400+
 * deduplicated offers. This is the canonical internal type that the ingest
 * pipeline writes into the flight_pages DB tables.
 *
 * Source of truth for the Python side: sdk/python/letsfg/models/flights.py
 * (FlightOffer, FlightRoute, FlightSegment, FlightSearchResponse).
 *
 * CONNECTOR COVERAGE NOTES — fields that vary across our 180+ connectors:
 *
 *  bagsPrice
 *    Populated by ~15-20 connectors only (Traveloka, AirArabia, LH Group,
 *    Azul, AirCairo, SkyExpress, AirArabia…). Most connectors return {}.
 *    Keys used: carry_on, checked_bag, seat.  All values in offer currency.
 *    0.0 = fee included; absent key = connector didn't expose this data.
 *
 *  availabilitySeats
 *    Only populated by ~8 connectors (Hawaiian, JetBlue, Vivaaerobus,
 *    SalamAir, Biman, StarAir, SunCountry, SalamAir). null everywhere else.
 *
 *  conditions.refund_before_departure / change_before_departure
 *    Values 'allowed' | 'not_allowed' | 'allowed_with_fee' | 'unknown'.
 *    Populated by easemytrip_ota, some OTAs. Absent from most direct connectors.
 *
 *  conditions.virtual_interlining / throwaway_ticket / hidden_city
 *    Kiwi connector only — identifies Kiwi-specific booking hacks.
 *
 *  conditions.note / conditions.fare_note
 *    LH Group ("Indicative starting price from fare teaser"),
 *    El Al and Azerbaijan Airlines ("Fare from EveryMundo module").
 *
 *  conditions.price_type
 *    SAS only — "lowest_fare".
 *
 *  segment.airlineName
 *    Usually populated. A few low-data connectors leave it as ''.
 *
 *  segment.flightNo
 *    Present for most direct airline connectors. Often '' for meta connectors
 *    (Skyscanner, Momondo, Kayak) that return combined itineraries.
 *
 *  segment.aircraft
 *    Rarely populated; '' for the vast majority of connectors.
 *
 *  segment.cabinClass casing
 *    Varies: Kiwi returns 'ECONOMY'; most others return 'economy'.
 *    Normalize to lowercase at ingest time.
 *
 *  sourceTier
 *    'free'     = most direct airline connectors + OTAs (scraper-based)
 *    'low'      = Kiwi Tequila API (paid but cheap)
 *    'paid'     = GDS/NDC (Duffel, Amadeus) — cloud backend only
 *    'protocol' = Ryanair/WizzAir AIP protocol
 *
 *  priceNormalized
 *    Populated by the engine AFTER search, when it normalizes all prices to
 *    the requested currency. null before normalization runs.
 *
 *  bookingUrl
 *    '' for locked offers (is_locked=true).
 *    For Kiwi/meta connectors: a stable search deeplink (token URLs expire).
 *    For direct airlines: the airline's own booking URL or deeplink.
 *
 *  inbound
 *    null for one-way offers. Present for native round-trip offers AND for
 *    virtual-interlining combos built by combo_engine.py (id prefix 'combo_').
 *
 *  Virtual interlining combos (built by combo_engine.py):
 *    id prefix 'rt_'    = same-connector round-trip (native RT pairing)
 *    id prefix 'combo_' = cross-airline virtual interlining
 *    source             = source of the outbound leg
 */

// ── Primitives ────────────────────────────────────────────────────────────────

/** ISO 4217 currency code (e.g. 'EUR', 'USD', 'PLN'). */
export type CurrencyCode = string;

/** IATA airport or city code (2–4 uppercase letters). */
export type IataCode = string;

/** ISO 8601 datetime string (e.g. '2026-06-15T08:30:00'). */
export type IsoDatetime = string;

/** Source tier describing the cost/origin of a connector's data. */
export type SourceTier = 'free' | 'low' | 'paid' | 'protocol';

/** Fare class bucket — broad categorization used for page content. */
export type FareClassBucket = 'Y' | 'M' | 'L' | 'Q' | 'other';

// ── Segment / Route ───────────────────────────────────────────────────────────

/**
 * A single flight leg (one take-off + landing).
 * Maps to Python: FlightSegment in sdk/python/letsfg/models/flights.py
 */
export interface NormalizedSegment {
  /** Operating carrier IATA code (always present). */
  airline: string;
  /** Human-readable airline name. '' if connector didn't provide. */
  airlineName: string;
  /** Flight number e.g. 'FR1234'. '' for meta connectors that don't expose it. */
  flightNo: string;
  /** Departure airport IATA code. */
  origin: IataCode;
  /** Arrival airport IATA code. */
  destination: IataCode;
  /** Departure city name. '' if connector didn't provide. */
  originCity: string;
  /** Arrival city name. '' if connector didn't provide. */
  destinationCity: string;
  /** Local departure time (ISO 8601). */
  departure: IsoDatetime;
  /** Local arrival time (ISO 8601). */
  arrival: IsoDatetime;
  /** Leg duration in seconds. 0 if not provided by connector. */
  durationSeconds: number;
  /**
   * Cabin class — casing is connector-dependent (normalize to lowercase at ingest).
   * Common values: 'economy', 'premiumeconomy', 'business', 'first'.
   * Kiwi returns uppercase 'ECONOMY', 'BUSINESS' etc.
   */
  cabinClass: string;
  /**
   * Aircraft type (e.g. 'B738'). '' for almost all connectors.
   * Only a handful of FSC connectors populate this.
   */
  aircraft: string;
}

/**
 * One direction of a journey (outbound or inbound), composed of segments.
 * Maps to Python: FlightRoute
 */
export interface NormalizedRoute {
  segments: NormalizedSegment[];
  /** Sum of all segment durations + layover times, in seconds. */
  totalDurationSeconds: number;
  /** Number of stopovers (= segments.length - 1 for a typical itinerary). */
  stopovers: number;
}

// ── Offer ─────────────────────────────────────────────────────────────────────

/**
 * Bags and ancillary fee structure.
 * Only populated by ~15–20 connectors. All values in offer currency.
 *
 * 0 = fee included (e.g. AirArabia includes one checked bag)
 * absent key = connector did not expose this information
 */
export interface BagsPrice {
  /** Cabin bag / carry-on fee. */
  carry_on?: number;
  /** First checked bag fee. */
  checked_bag?: number;
  /** Seat selection fee. */
  seat?: number;
  /** Extensibility — future keys (e.g. extra_bag, sports_equipment). */
  [key: string]: number | undefined;
}

/**
 * Per-offer policy/condition flags.
 * All values are strings. An absent key means the connector didn't provide that data.
 */
export interface OfferConditions {
  /** Refund policy before departure. */
  refund_before_departure?: 'allowed' | 'not_allowed' | 'allowed_with_fee' | 'unknown';
  /** Change/reschedule policy before departure. */
  change_before_departure?: 'allowed' | 'not_allowed' | 'allowed_with_fee' | 'unknown';
  /** Kiwi only — "Different airlines combined for best price". */
  virtual_interlining?: string;
  /** Kiwi only — throwaway ticketing flag. */
  throwaway_ticket?: string;
  /** Kiwi only — true hidden-city ticketing. */
  hidden_city?: string;
  /** El Al / Azerbaijan Airlines — describes fare source. */
  fare_note?: string;
  /** Cabin description (El Al, Azerbaijan Airlines). */
  cabin?: string;
  /** LH Group — "Indicative starting price from fare teaser". */
  note?: string;
  /** SAS — "lowest_fare". */
  price_type?: string;
  /** Catch-all for any future connector-specific keys. */
  [key: string]: string | undefined;
}

/**
 * A single normalized flight offer.
 * Maps to Python: FlightOffer in sdk/python/letsfg/models/flights.py
 */
export interface NormalizedOffer {
  /** Unique offer ID (connector-scoped, e.g. 'fr_abc123', 'ks_def456'). */
  id: string;
  /** Base fare in offer currency, excluding bags/fees. */
  price: number;
  /** ISO 4217 currency code. */
  currency: CurrencyCode;
  /** Formatted price string (e.g. '89.50 EUR'). '' if not provided by connector. */
  priceFormatted: string;
  /**
   * Price normalized to the session's target currency for cross-offer comparison.
   * null before the engine's currency normalization pass runs.
   */
  priceNormalized: number | null;
  /** Outbound journey (always present). */
  outbound: NormalizedRoute;
  /**
   * Return journey. null for one-way offers.
   * Present for native RT offers AND virtual-interlining combos (combo_engine.py).
   */
  inbound: NormalizedRoute | null;
  /** All airline IATA codes in the itinerary (marketing or operating carriers). */
  airlines: string[];
  /** Validating/marketing carrier IATA code. '' if not resolved. */
  ownerAirline: string;
  /**
   * Ancillary pricing. {} if connector didn't provide bag data.
   * See BagsPrice for key semantics.
   */
  bagsPrice: BagsPrice;
  /**
   * Seats remaining at this price. null if connector didn't provide.
   * Only ~8 connectors populate this (Hawaiian, JetBlue, Vivaaerobus, etc.).
   */
  availabilitySeats: number | null;
  /** Policy flags. See OfferConditions for per-key connector coverage. */
  conditions: OfferConditions;
  /**
   * Source connector name (e.g. 'ryanair_direct', 'kiwi_connector',
   * 'skyscanner_meta', 'edreams_ota').
   * Suffix conventions: _direct = airline site, _ota = OTA, _meta = meta-search.
   */
  source: string;
  /** Data cost tier. Most scrapers are 'free'. */
  sourceTier: SourceTier;
  /** Whether booking details are behind the unlock paywall. */
  isLocked: boolean;
  /** When this offer was fetched (ISO 8601). */
  fetchedAt: IsoDatetime;
  /**
   * Booking URL or search deeplink.
   * '' for locked offers. For meta connectors: stable search deeplink
   * (token-based URLs expire in minutes and are not stored).
   */
  bookingUrl: string;
}

// ── Session ───────────────────────────────────────────────────────────────────

/**
 * Anonymized search parameters.
 * Contains ONLY aggregate/non-identifying values.
 * No user ID, IP, session token, or device fingerprint must ever appear here.
 */
export interface AnonymizedSearchParams {
  /** Total passenger count (adults + children). Infants excluded from pricing count. */
  paxCount: number;
  /** Whether this was a one-way or round-trip search. */
  tripType: 'oneway' | 'return';
  /**
   * Requested cabin class. null = no preference (any cabin).
   * 'M' = economy, 'W' = premium economy, 'C' = business, 'F' = first.
   */
  cabinPreference: 'M' | 'W' | 'C' | 'F' | null;
  /** Days between search date and departure date. Used for advance-booking analysis. */
  advanceBookingDays: number;
  /** Max stopovers requested (0 = direct only, 1–4 = with connections). */
  maxStopovers: number;
  /** Currency the user requested prices in (ISO 4217). */
  currencyCode: CurrencyCode;
}

/**
 * Per-connector execution telemetry.
 * Maps to Python: ConnectorTelemetry dataclass in connectors/engine.py
 */
export interface ConnectorRunResult {
  /** Connector name (e.g. 'ryanair_direct', 'skyscanner_meta'). */
  connector: string;
  /** Whether the connector returned ≥1 offer without error. */
  ok: boolean;
  /** Number of offers returned. */
  offers: number;
  /** Wall-clock execution time in milliseconds. */
  latencyMs: number;
  /**
   * Error class name if ok=false, e.g. 'TimeoutError', 'HTTPError'.
   * null if ok=true.
   */
  errorType: string | null;
  /** Truncated error message. null if ok=true. */
  errorMessage: string | null;
  /**
   * Broad error category for bucketing.
   * 'slot_timeout'   = waited too long for a browser semaphore slot
   * 'search_timeout' = connector timed out during search
   * 'crash'          = unhandled exception
   * 'http_error'     = non-2xx HTTP response
   */
  errorCategory: 'slot_timeout' | 'search_timeout' | 'crash' | 'http_error' | null;
  /** HTTP status code if errorCategory='http_error'. null otherwise. */
  httpStatus: number | null;
}

/**
 * Price statistics computed across all offers in the session.
 * All values are in targetCurrency after normalization.
 * null means no offers were returned (empty session).
 */
export interface SessionPriceStats {
  offerCount: number;
  /** Distinct carrier IATA codes across all offers. */
  carrierCount: number;
  /** Number of connectors that returned ≥1 offer. */
  connectorCount: number;
  priceMin: number | null;
  priceMax: number | null;
  priceP25: number | null;
  priceP50: number | null;
  priceP75: number | null;
  priceP95: number | null;
  /**
   * Average total ancillary fee (bags_price sum) across offers that provided
   * bag pricing data. null if no offers in the session provided bag data.
   */
  hiddenFeesAvg: number | null;
  /**
   * Average ancillary fee as a fraction of base price (0.0–1.0+).
   * null if hiddenFeesAvg is null.
   */
  hiddenFeesPctAvg: number | null;
}

/**
 * The canonical internal representation of one complete agent search session.
 *
 * One session = one user-triggered (or automated) flight search that ran
 * 180+ connectors in parallel and collected all available offers.
 *
 * PRIVACY CONTRACT:
 *   - sessionId is an opaque random/hashed ID with no link to any user account.
 *   - searchParams contains ONLY aggregate, non-identifying fields.
 *   - No IP address, user ID, email, browser fingerprint, or device info is stored.
 *
 * CONTENT RICHNESS:
 *   A single session is sufficient to publish a flight page because it provides:
 *   - 15–400+ offers across all connectors (vs. 3–10 from a single GDS)
 *   - Full price distribution across airlines, fare classes, and booking channels
 *   - Connector-level comparison (direct airline price vs. OTA vs. meta)
 *   - Bags/ancillary fee data where available
 */
export interface AgentSearchSession {
  /**
   * Anonymized session ID — assigned by the agent pipeline.
   * Opaque string; no link to any user or device.
   */
  sessionId: string;

  /** Departure airport/city IATA code (3–4 chars). */
  originIata: IataCode;
  /** Arrival airport/city IATA code (3–4 chars). */
  destIata: IataCode;

  /** Human-readable departure city (resolved from IATA). '' if not resolved. */
  originCity: string;
  /** Human-readable arrival city (resolved from IATA). '' if not resolved. */
  destCity: string;

  /** When the search ran (ISO 8601 UTC). */
  searchedAt: IsoDatetime;

  /** Anonymized, aggregate search parameters. See AnonymizedSearchParams. */
  searchParams: AnonymizedSearchParams;

  /**
   * All deduplicated offers returned by all connectors, sorted by
   * priceNormalized ascending (nulls last).
   */
  offers: NormalizedOffer[];

  /** Price statistics computed after normalization. */
  stats: SessionPriceStats;

  /**
   * Names of all connectors that ran (regardless of whether they returned offers).
   * e.g. ['ryanair_direct', 'wizzair_direct', 'skyscanner_meta', ...]
   */
  dataSources: string[];

  /**
   * Per-connector execution telemetry for debugging and quality assessment.
   * Includes both successful and failed connector runs.
   */
  connectorResults: ConnectorRunResult[];

  /**
   * ISO 4217 currency code that all priceNormalized values are expressed in.
   * Matches searchParams.currencyCode.
   */
  targetCurrency: CurrencyCode;
}
