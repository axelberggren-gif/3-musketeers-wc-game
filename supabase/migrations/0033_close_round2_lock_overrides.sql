-- 0033_close_round2_lock_overrides.sql
--
-- Close every league that was granted post-knockout bracket access.
--
-- Migration 0032 added a per-league exemption from the round-2 (knockout
-- bracket) lock: leagues whose id is listed in
--   tournament.locked_overrides -> 'round2_open_leagues'  (a jsonb array of
--   uuid strings)
-- stay editable past the global knockout start (tournament.knockout_start_at),
-- while every other league is locked. Opening a league is a manual data write
-- (the one-liner in 0032's header), not a tracked migration.
--
-- Some leagues were opened briefly and now need to be closed again. This resets
-- the exemption list to an empty array, so round2_locked_for(uid) falls back to
-- the global lock for everyone — the bracket is locked for all leagues again.
-- (round2_locked_for() reads coalesce(... -> 'round2_open_leagues', '[]'), so
-- '[]' is equivalent to having no exempt leagues at all.)
--
-- Pure data UPDATE: no schema change (so no `npm run db:types`), no function or
-- trigger change, no point values touched (points-sync holds). Idempotent and
-- append-only (0032 untouched) — coalesce guards a NULL locked_overrides, and
-- re-running just re-writes '[]'. To reopen a league later, append its id to the
-- array again per 0032's header.

update tournament
set locked_overrides = jsonb_set(
  coalesce(locked_overrides, '{}'::jsonb),
  '{round2_open_leagues}',
  '[]'::jsonb
)
where id = 1;
