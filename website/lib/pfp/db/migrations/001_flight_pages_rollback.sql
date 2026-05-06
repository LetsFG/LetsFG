-- =============================================================================
-- 001_flight_pages_rollback.sql
-- Rollback for: 001_flight_pages.sql
--
-- Drops ALL objects created in the forward migration, in reverse dependency order.
-- Run this to fully remove the Programmatic Flight Pages schema.
-- =============================================================================

BEGIN;

-- ── Tables (child → parent order to respect FK constraints) ──────────────────

DROP TABLE IF EXISTS page_audit_log              CASCADE;
DROP TABLE IF EXISTS page_experiments            CASCADE;
DROP TABLE IF EXISTS route_distribution_snapshots CASCADE;
DROP TABLE IF EXISTS flight_offers_aggregated    CASCADE;
DROP TABLE IF EXISTS flight_search_sessions      CASCADE;
DROP TABLE IF EXISTS flight_routes               CASCADE;

-- ── Custom types ──────────────────────────────────────────────────────────────

DROP TYPE IF EXISTS data_confidence;
DROP TYPE IF EXISTS page_status;

COMMIT;
