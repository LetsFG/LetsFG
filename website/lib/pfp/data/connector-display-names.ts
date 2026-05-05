/**
 * connector-display-names.ts — human-readable names for connector slugs.
 *
 * Maps raw connector_name slugs (as stored in NormalizedOffer.source) to
 * display metadata used in the FlightPage template.
 */

export interface ConnectorDisplayMeta {
  /** Display name — no underscores, properly capitalized. */
  displayName: string
  /** What carrier types this connector focuses on. */
  type: 'budget_only' | 'premium_only' | 'mixed'
}

const CONNECTOR_DISPLAY_NAMES: Record<string, ConnectorDisplayMeta> = {
  // ── Direct airline connectors (budget/LCC) ──────────────────────────────
  ryanair_direct:       { displayName: 'Ryanair (direct)',          type: 'budget_only' },
  wizzair_direct:       { displayName: 'Wizz Air (direct)',         type: 'budget_only' },
  easyjet_direct:       { displayName: 'easyJet (direct)',          type: 'budget_only' },
  flydubai_direct:      { displayName: 'flydubai (direct)',         type: 'budget_only' },
  allegiant_direct:     { displayName: 'Allegiant (direct)',        type: 'budget_only' },
  frontier_direct:      { displayName: 'Frontier (direct)',         type: 'budget_only' },
  spirit_direct:        { displayName: 'Spirit (direct)',           type: 'budget_only' },
  southwest_direct:     { displayName: 'Southwest (direct)',        type: 'budget_only' },
  vueling_direct:       { displayName: 'Vueling (direct)',          type: 'budget_only' },
  norwegian_direct:     { displayName: 'Norwegian (direct)',        type: 'budget_only' },
  eurowings_direct:     { displayName: 'Eurowings (direct)',        type: 'budget_only' },
  airasia_direct:       { displayName: 'AirAsia (direct)',          type: 'budget_only' },
  indigo_direct:        { displayName: 'IndiGo (direct)',           type: 'budget_only' },
  flysafair_direct:     { displayName: 'FlySafair (direct)',        type: 'budget_only' },
  flybondi_direct:      { displayName: 'Flybondi (direct)',         type: 'budget_only' },
  transavia_direct:     { displayName: 'Transavia (direct)',        type: 'budget_only' },
  wizz_direct:          { displayName: 'Wizz Air (direct)',         type: 'budget_only' },
  avelo_direct:         { displayName: 'Avelo (direct)',            type: 'budget_only' },
  flair_direct:         { displayName: 'Flair (direct)',            type: 'budget_only' },
  breeze_direct:        { displayName: 'Breeze Airways (direct)',   type: 'budget_only' },
  // ── Direct airline connectors (full-service) ────────────────────────────
  lufthansa_direct:     { displayName: 'Lufthansa (direct)',        type: 'premium_only' },
  britishairways_direct:{ displayName: 'British Airways (direct)',  type: 'premium_only' },
  airfrance_direct:     { displayName: 'Air France (direct)',       type: 'premium_only' },
  klm_direct:           { displayName: 'KLM (direct)',              type: 'premium_only' },
  swiss_direct:         { displayName: 'Swiss (direct)',            type: 'premium_only' },
  austrian_direct:      { displayName: 'Austrian (direct)',         type: 'premium_only' },
  united_direct:        { displayName: 'United (direct)',           type: 'premium_only' },
  delta_direct:         { displayName: 'Delta (direct)',            type: 'premium_only' },
  american_direct:      { displayName: 'American Airlines (direct)', type: 'premium_only' },
  emirates_direct:      { displayName: 'Emirates (direct)',         type: 'premium_only' },
  qantas_direct:        { displayName: 'Qantas (direct)',           type: 'premium_only' },
  singaporeairlines_direct: { displayName: 'Singapore Airlines (direct)', type: 'premium_only' },
  etihad_direct:        { displayName: 'Etihad (direct)',           type: 'premium_only' },
  finnair_direct:       { displayName: 'Finnair (direct)',          type: 'premium_only' },
  iberia_direct:        { displayName: 'Iberia (direct)',           type: 'premium_only' },
  tap_direct:           { displayName: 'TAP Air Portugal (direct)', type: 'premium_only' },
  lol_direct:           { displayName: 'LOT Polish (direct)',       type: 'premium_only' },
  lot_direct:           { displayName: 'LOT Polish (direct)',       type: 'premium_only' },
  turkish_direct:       { displayName: 'Turkish Airlines (direct)', type: 'premium_only' },
  aeroflot_direct:      { displayName: 'Aeroflot (direct)',         type: 'premium_only' },
  // ── OTA connectors (mixed coverage) ─────────────────────────────────────
  kiwi_connector:       { displayName: 'Kiwi.com',                  type: 'mixed' },
  kiwi_ota:             { displayName: 'Kiwi.com',                  type: 'mixed' },
  skyscanner_meta:      { displayName: 'Skyscanner',                type: 'mixed' },
  kayak_meta:           { displayName: 'KAYAK',                     type: 'mixed' },
  momondo_meta:         { displayName: 'Momondo',                   type: 'mixed' },
  google_flights:       { displayName: 'Google Flights',            type: 'mixed' },
  expedia_ota:          { displayName: 'Expedia',                   type: 'mixed' },
  booking_ota:          { displayName: 'Booking.com',               type: 'mixed' },
  edreams_ota:          { displayName: 'eDreams',                   type: 'mixed' },
  lastminute_ota:       { displayName: 'lastminute.com',            type: 'mixed' },
  opodo_ota:            { displayName: 'Opodo',                     type: 'mixed' },
  cheapflights_meta:    { displayName: 'Cheapflights',              type: 'mixed' },
  wego_meta:            { displayName: 'Wego',                      type: 'mixed' },
  jetradar_meta:        { displayName: 'Jetradar',                  type: 'mixed' },
  aviasales_meta:       { displayName: 'Aviasales',                 type: 'mixed' },
  trip_ota:             { displayName: 'Trip.com',                  type: 'mixed' },
  agoda_ota:            { displayName: 'Agoda Flights',             type: 'mixed' },
  cleartrip_ota:        { displayName: 'Cleartrip',                 type: 'mixed' },
  makemytrip_ota:       { displayName: 'MakeMyTrip',                type: 'mixed' },
  easemytrip_ota:       { displayName: 'EaseMyTrip',                type: 'mixed' },
  despegar_ota:         { displayName: 'Despegar',                  type: 'mixed' },
  almundo_ota:          { displayName: 'Almundo',                   type: 'mixed' },
}

/**
 * Look up display metadata for a connector slug.
 * Falls back to a humanized version of the slug when not registered.
 */
export function getConnectorDisplayMeta(slug: string): ConnectorDisplayMeta {
  if (CONNECTOR_DISPLAY_NAMES[slug]) {
    return CONNECTOR_DISPLAY_NAMES[slug]
  }
  // Fallback: humanize slug (replace underscores with spaces, title-case)
  const humanized = slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
  // Guess type from suffix
  const type: ConnectorDisplayMeta['type'] =
    slug.endsWith('_direct') ? 'budget_only' :
    slug.endsWith('_ota') || slug.endsWith('_meta') ? 'mixed' :
    'mixed'
  return { displayName: humanized, type }
}
