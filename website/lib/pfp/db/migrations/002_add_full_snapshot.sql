-- =============================================================================
-- 002_add_full_snapshot.sql
-- Adds full_snapshot_json column to route_distribution_snapshots.
--
-- Rationale: RouteDistributionData includes computed fields (tldr, key_facts,
-- llm_rationale, offer_highlights, amenity_summary) that don't map cleanly to
-- the existing NUMERIC/JSONB columns. Storing the full computed blob avoids
-- impedance mismatch at render time and keeps page reads to a single JOIN.
--
-- Rollback: 002_add_full_snapshot_rollback.sql
-- =============================================================================

BEGIN;

ALTER TABLE route_distribution_snapshots
  ADD COLUMN full_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN route_distribution_snapshots.full_snapshot_json IS
  'Serialized RouteDistributionData including offer_highlights, llm_rationale, '
  'amenity_summary, and all distribution fields. Written by the ingest trigger '
  'after ingestAgentSession() and getRouteDistributionData() complete.';

COMMIT;
