-- 0027_league_standings_access.sql
--
-- Close the cross-league leaderboard leak. `league_standings` is a
-- MATERIALIZED VIEW (created in 0002_scoring.sql, recreated in
-- 0023_league_internal_bets.sql), and Postgres cannot apply RLS to matviews —
-- so any authenticated user could `select * from league_standings` and read
-- every league's roster + point totals, including leagues they don't belong
-- to (the matview is even queried straight from the browser by the realtime
-- refetch in LeaderboardLive.tsx). Every underlying table is member-scoped
-- under RLS; the matview was the one hole.
--
-- Fix: revoke direct SELECT from anon/authenticated (service_role + postgres
-- keep their privileges, so `refresh materialized view` and admin tooling are
-- unaffected) and route all user reads through a SECURITY DEFINER accessor
-- `get_league_standings(p_league_id)` that returns rows only when the caller
-- is a member of that league (`is_league_member()`, the 0008 helper — itself
-- SECURITY DEFINER so the membership probe can't recurse through RLS). All TS
-- read sites switch from `.from("league_standings")` to
-- `.rpc("get_league_standings", { p_league_id })`; `refresh_league_standings()`
-- callers are unaffected.
--
-- Note for future migrations: like `refresh_league_standings()`, this function
-- depends on the matview — a migration that recreates `league_standings` must
-- `drop function if exists get_league_standings(uuid)` first and recreate it
-- after (mirror 0023's drop-fn → drop-matview → recreate dance) — AND re-run
-- the `revoke select` below, since a freshly created matview picks up the
-- schema's default grants again and would silently reopen direct SELECT.
--
-- Append-only (0002/0023 untouched), idempotent (revoke/grant + create or
-- replace re-apply cleanly). No schema change → no `npm run db:types`
-- (types.ts hand-gains the new RPC meanwhile; the CLI reproduces it once the
-- dev DB applies this); no point values touched.

revoke select on league_standings from anon, authenticated;

create or replace function get_league_standings(p_league_id uuid)
returns setof league_standings
language sql
security definer
set search_path = public
stable
as $$
  select *
  from league_standings
  where league_id = p_league_id
    and is_league_member(p_league_id, auth.uid());
$$;

-- Functions default to EXECUTE for PUBLIC — lock execution down to logged-in
-- users only (the function itself then gates on league membership).
revoke execute on function get_league_standings(uuid) from public, anon;
grant execute on function get_league_standings(uuid) to authenticated;
