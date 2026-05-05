-- =============================================================================
-- 001_flight_pages.sql
-- Programmatic Flight Pages — initial schema
--
-- Tables:
--   flight_routes                  — one row per unique origin→destination pair
--   flight_search_sessions         — one row per anonymized agent search session
--   flight_offers_aggregated       — per-carrier/cabin/fare-bucket aggregates
--   route_distribution_snapshots   — materialized snapshot for page rendering
--   page_experiments               — A/B experiment tracking per route
--   page_audit_log                 — immutable audit trail for page status changes
--
-- Rollback: 001_flight_pages_rollback.sql
-- =============================================================================

BEGIN;

-- ── Custom types ──────────────────────────────────────────────────────────────

CREATE TYPE page_status AS ENUM (
    'draft',       -- created but not yet reviewed / quality-gated
    'published',   -- live, indexed by search engines
    'noindex',     -- live but not indexed (low quality / thin content)
    'archived'     -- removed from public view
);

CREATE TYPE data_confidence AS ENUM (
    'high',    -- ≥10 sessions, ≥100 offers, connectors from ≥3 source types
    'medium',  -- ≥3 sessions or ≥30 offers
    'low'      -- single session or very few offers
);

-- ── flight_routes ─────────────────────────────────────────────────────────────
-- One row per unique origin→destination pair (directional: GDN→BCN ≠ BCN→GDN).
-- This is the root entity for all page content.

CREATE TABLE flight_routes (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_iata                CHAR(3)     NOT NULL,
    dest_iata                  CHAR(3)     NOT NULL,
    origin_city                TEXT        NOT NULL DEFAULT '',
    dest_city                  TEXT        NOT NULL DEFAULT '',

    first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Rolling counters updated on each ingest
    session_count              INT         NOT NULL DEFAULT 0,
    total_offers_indexed       INT         NOT NULL DEFAULT 0,

    page_status                page_status NOT NULL DEFAULT 'draft',
    quality_score              FLOAT,
    last_quality_evaluated_at  TIMESTAMPTZ,

    CONSTRAINT uq_route UNIQUE (origin_iata, dest_iata),
    CONSTRAINT chk_iata_origin UNIQUE (origin_iata, dest_iata),  -- enforced by uq_route
    CONSTRAINT chk_origin_iata CHECK (origin_iata ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_dest_iata   CHECK (dest_iata   ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_not_self    CHECK (origin_iata <> dest_iata)
);

CREATE INDEX idx_fr_page_status      ON flight_routes (page_status);
CREATE INDEX idx_fr_quality_score    ON flight_routes (quality_score DESC NULLS LAST);
CREATE INDEX idx_fr_last_updated     ON flight_routes (last_updated_at DESC);
CREATE INDEX idx_fr_origin_iata      ON flight_routes (origin_iata);
CREATE INDEX idx_fr_dest_iata        ON flight_routes (dest_iata);

-- ── flight_search_sessions ────────────────────────────────────────────────────
-- One row per agent search session written by the ingest pipeline.
-- All user-identifying data has been stripped BEFORE writing here.

CREATE TABLE flight_search_sessions (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id           UUID        NOT NULL
                                   REFERENCES flight_routes (id)
                                   ON DELETE CASCADE,

    -- Anonymized session ID from the agent pipeline (opaque UUID or hash).
    -- No link to any user account, IP address, or device fingerprint.
    session_id         TEXT        NOT NULL UNIQUE,

    searched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Aggregate, non-identifying search parameters.
    -- Schema: { pax_count, trip_type, cabin_preference, advance_booking_days,
    --            max_stopovers, currency_code }
    -- MUST NOT contain: user_id, email, IP address, device_id, session_token.
    search_params      JSONB       NOT NULL DEFAULT '{}',

    offer_count        INT         NOT NULL DEFAULT 0,
    carrier_count      INT         NOT NULL DEFAULT 0,
    connector_count    INT         NOT NULL DEFAULT 0,

    -- Price statistics in the session's target currency (priceNormalized).
    -- All NUMERIC to avoid floating-point rounding in aggregation queries.
    price_min          NUMERIC(12, 2),
    price_max          NUMERIC(12, 2),
    price_p25          NUMERIC(12, 2),
    price_p50          NUMERIC(12, 2),
    price_p75          NUMERIC(12, 2),
    price_p95          NUMERIC(12, 2),

    -- Average ancillary (bags/seat) fees and as a fraction of base price.
    -- NULL = no offers in session provided bag pricing data.
    hidden_fees_avg    NUMERIC(12, 2),
    hidden_fees_pct_avg NUMERIC(8, 6),

    -- Connector names that returned ≥1 offer, e.g. '{ryanair_direct,skyscanner_meta}'.
    data_sources       TEXT[]      NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_fss_route_id    ON flight_search_sessions (route_id);
CREATE INDEX idx_fss_searched_at ON flight_search_sessions (searched_at DESC);
CREATE INDEX idx_fss_session_id  ON flight_search_sessions (session_id);

-- ── flight_offers_aggregated ──────────────────────────────────────────────────
-- Per-carrier × cabin-class × fare-bucket aggregation within one session.
-- Raw offers are NOT stored. Only statistical summaries per bucket.

CREATE TABLE flight_offers_aggregated (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id             UUID        NOT NULL
                                       REFERENCES flight_search_sessions (id)
                                       ON DELETE CASCADE,
    route_id               UUID        NOT NULL
                                       REFERENCES flight_routes (id)
                                       ON DELETE CASCADE,

    carrier                TEXT        NOT NULL,  -- airline IATA code, e.g. 'FR', 'W6'
    cabin_class            TEXT        NOT NULL DEFAULT 'economy',
    -- Fare class bucket for price-tier analysis:
    --   Y = full / flex economy
    --   M = standard economy
    --   L = discounted economy
    --   Q = ultra-discounted / sale
    --   other = fare class not mapped / unavailable
    fare_class_bucket      TEXT        NOT NULL DEFAULT 'other',

    offer_count_in_bucket  INT         NOT NULL DEFAULT 0,

    price_min              NUMERIC(12, 2),
    price_max              NUMERIC(12, 2),
    price_p50              NUMERIC(12, 2),

    -- Ancillary fees for this carrier/bucket (NULL = not available).
    hidden_fees_avg        NUMERIC(12, 2),
    hidden_fees_pct_avg    NUMERIC(8, 6),

    -- Which of our connectors sourced these offers (e.g. 'ryanair_direct').
    connector_name         TEXT        NOT NULL,

    CONSTRAINT chk_fare_class_bucket
        CHECK (fare_class_bucket IN ('Y', 'M', 'L', 'Q', 'other')),
    CONSTRAINT chk_cabin_class
        CHECK (cabin_class IN ('economy', 'premiumeconomy', 'business', 'first', 'other'))
);

CREATE INDEX idx_foa_session_id    ON flight_offers_aggregated (session_id);
CREATE INDEX idx_foa_route_id      ON flight_offers_aggregated (route_id);
CREATE INDEX idx_foa_carrier       ON flight_offers_aggregated (carrier);
CREATE INDEX idx_foa_connector     ON flight_offers_aggregated (connector_name);

-- ── route_distribution_snapshots ─────────────────────────────────────────────
-- One row per route. Recomputed by the DistributionService whenever a new
-- session is ingested (or by a scheduled cron job). Used directly by the
-- Next.js page template for rendering — no JOIN needed at render time.
--
-- This is NOT a PostgreSQL materialized view because we need to control when
-- and how the snapshot is refreshed (quality gate, feature flags, etc.).

CREATE TABLE route_distribution_snapshots (
    -- 1:1 with flight_routes
    route_id                   UUID        PRIMARY KEY
                                           REFERENCES flight_routes (id)
                                           ON DELETE CASCADE,
    snapshot_computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Price distribution histogram.
    -- Schema: [{ bucket_min, bucket_max, offer_count, carriers: string[] }, ...]
    histogram_buckets          JSONB       NOT NULL DEFAULT '[]',

    -- Per-carrier cheapest price and offer count.
    -- Schema: [{ carrier, carrier_name, cheapest_price, currency,
    --             offer_count, direct_available, cabin_classes: string[] }, ...]
    carrier_summary            JSONB       NOT NULL DEFAULT '[]',

    -- Price delta between direct-airline connectors vs. OTA/meta connectors
    -- for the same route. Replaces legacy GDS/NDC comparison.
    -- Schema: [{ connector_type, connector_name, median_price, currency,
    --             delta_vs_direct_pct }, ...]
    connector_comparison       JSONB       NOT NULL DEFAULT '[]',

    -- Distribution across fare class buckets (Y/M/L/Q/other).
    -- Schema: { Y: { count, price_p50 }, M: {...}, L: {...}, Q: {...}, other: {...} }
    fare_class_distribution    JSONB       NOT NULL DEFAULT '{}',

    -- Outlier analysis (unusually cheap or expensive offers worth highlighting).
    -- Schema: { floor_price, floor_carrier, ceiling_price, ceiling_carrier,
    --            outlier_count, method }
    outlier_summary            JSONB       NOT NULL DEFAULT '{}',

    -- True if the price distribution has two distinct modes (e.g. LCC vs. FSC).
    is_bimodal                 BOOLEAN     NOT NULL DEFAULT FALSE,
    -- Human-readable explanation for the bimodal split (NULL if is_bimodal=FALSE).
    -- e.g. "Budget carriers (Ryanair, Wizz Air) cluster around €45–€90,
    --        while full-service carriers cluster around €180–€260."
    bimodal_insight            TEXT,

    total_offers_in_snapshot   INT         NOT NULL DEFAULT 0,
    session_count_contributing INT         NOT NULL DEFAULT 0,
    data_confidence            data_confidence NOT NULL DEFAULT 'low'
);

-- ── page_experiments ──────────────────────────────────────────────────────────
-- A/B experiments scoped to individual routes (e.g. headline copy, CTA text,
-- price display format). Linked to route; experiment results drive page updates.

CREATE TABLE page_experiments (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id         UUID        NOT NULL
                                 REFERENCES flight_routes (id)
                                 ON DELETE CASCADE,
    experiment_key   TEXT        NOT NULL,
    variant_id       TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ,
    winner_variant   TEXT
);

CREATE INDEX idx_pe_route_id         ON page_experiments (route_id);
CREATE INDEX idx_pe_experiment_key   ON page_experiments (experiment_key);

-- ── page_audit_log ────────────────────────────────────────────────────────────
-- Immutable audit trail. Every page status change, quality gate decision,
-- and manual override must write a row here.
-- This table is APPEND-ONLY. No UPDATE or DELETE.

CREATE TABLE page_audit_log (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id         UUID        NOT NULL
                                 REFERENCES flight_routes (id)
                                 ON DELETE CASCADE,
    -- Action taken, e.g. 'publish', 'unpublish', 'quality_fail', 'noindex',
    --   'archive', 'snapshot_refresh', 'experiment_start', 'experiment_end'.
    action           TEXT        NOT NULL,
    previous_status  TEXT,   -- page_status before the action (NULL for first write)
    new_status       TEXT,   -- page_status after the action (NULL if status unchanged)
    reason           TEXT,   -- human/machine explanation, e.g. 'quality_score < 0.6'
    -- Who/what triggered the action:
    --   'ingest_pipeline', 'quality_gate', 'cron_refresh', 'admin:<user_id>'.
    -- Note: user IDs here refer to ADMIN users only (ops), never to end-users.
    triggered_by     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pal_route_id    ON page_audit_log (route_id);
CREATE INDEX idx_pal_created_at  ON page_audit_log (created_at DESC);
CREATE INDEX idx_pal_action      ON page_audit_log (action);

COMMIT;
