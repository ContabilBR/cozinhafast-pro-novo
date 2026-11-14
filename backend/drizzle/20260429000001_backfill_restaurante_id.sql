-- No-op on purpose.
-- This hand-written migration carries a 2025 timestamp in meta/_journal.json, so the
-- incrementally migrated dev database always skipped it. Its work (restaurante_id columns,
-- backfill, per-restaurant uniques and indexes) is done by 20260727223043_black_queen_noir
-- and the migrations after it. Running it on a fresh database made those later
-- migrations fail (e.g. DROP CONSTRAINT "mesas_numero_unique" does not exist).
SELECT 1;
