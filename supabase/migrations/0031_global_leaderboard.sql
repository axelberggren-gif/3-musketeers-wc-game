-- 0031_global_leaderboard.sql
--
-- Portal-wide global leaderboard. The app only had per-league boards
-- (`league_standings` matview + the `get_league_standings(p_league_id)` accessor
-- from 0027). This adds a single ranking across ALL players, regardless of league.
--
-- A global total is exactly "sum each user's GLOBAL point awards". Since 0023,
-- `point_awards.league_id IS NULL` marks global awards (group-stage 1X2, bracket,
-- tournament, props — identical in every league a user belongs to) while a
-- non-null `league_id` marks league-scoped awards (the crown 👑 / wooden-spoon 💩
-- bets). Summing only the `league_id IS NULL` rows gives a clean cross-league
-- total that those per-league social bets can't distort.
--
-- Unlike the league board this is a live aggregation FUNCTION, not a matview:
-- it needs no `refresh_*` wiring (so no scorer changes) and reflects new awards
-- immediately on the realtime refetch. Fine at friends-league scale.
--
-- Like `get_league_standings`, it's SECURITY DEFINER (it reads `profiles` +
-- `point_awards` across all users) and execution is locked to authenticated
-- users. It exposes only aggregate username/display_name/points — never any
-- pick — so there's no RLS pick-leak; usernames are already public on
-- `/profile/[username]`.
--
-- Append-only — adds one brand-new function, touches nothing prior migrations
-- own. No table/column change → no `npm run db:types` strictly required
-- (types.ts hand-gains the new RPC meanwhile; the CLI reproduces it once the
-- dev DB applies this). No point values touched → points-sync invariant holds.

create or replace function get_global_standings()
returns table (
  user_id uuid,
  username text,
  display_name text,
  match_points int,
  bracket_points int,
  tournament_points int,
  prop_points int,
  total_points int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as user_id,
    p.username,
    p.display_name,
    coalesce(sum(case when pa.prediction_type = 'match'      then pa.points end), 0)::int as match_points,
    coalesce(sum(case when pa.prediction_type = 'bracket'    then pa.points end), 0)::int as bracket_points,
    coalesce(sum(case when pa.prediction_type = 'tournament' then pa.points end), 0)::int as tournament_points,
    coalesce(sum(case when pa.prediction_type = 'prop'       then pa.points end), 0)::int as prop_points,
    coalesce(sum(pa.points), 0)::int as total_points
  from profiles p
  join point_awards pa
    on pa.user_id = p.id
   and pa.league_id is null          -- GLOBAL awards only (crown/poop are league-scoped)
  where p.onboarded
  group by p.id, p.username, p.display_name
  having coalesce(sum(pa.points), 0) > 0   -- only users who've actually scored
  order by total_points desc;
$$;

-- Functions default to EXECUTE for PUBLIC — lock execution down to logged-in
-- users only (anon never reaches this; the global board is an in-app surface).
revoke execute on function get_global_standings() from public, anon;
grant execute on function get_global_standings() to authenticated;
