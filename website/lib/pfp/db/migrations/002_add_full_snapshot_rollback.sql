-- Rollback for 002_add_full_snapshot.sql
BEGIN;
ALTER TABLE route_distribution_snapshots DROP COLUMN IF EXISTS full_snapshot_json;
COMMIT;
