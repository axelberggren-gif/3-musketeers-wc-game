-- World Cup 2026 Bet Game — scoring functions and leaderboard view.
--
-- All scoring is idempotent: point_awards.idempotency_key uniquely identifies
-- the (user, prediction) pair so re-running a function is safe.

-- ---------------------------------------------------------------------------
-- Point constants (kept in sync with lib/scoring/rules.ts)
-- ---------------------------------------------------------------------------

create or replace function points_match_1x2() returns integer language sql immutable as $$ select 3 $$;
create or replace function points_bracket_slot(slot text) returns integer
language sql immutable as $$
  select case
    when slot like 'R16-%' then 2
    when slot like 'QF-%'  then 4
    when slot like 'SF-%'  then 6
    when slot = 'F'        then 10
    when slot = 'W'        then 15
    else 0
  end;
$$;
create or replace function points_tournament_winner()   returns integer language sql immutable as $$ select 25 $$;
create or replace function points_tournament_runner_up() returns integer language sql immutable as $$ select 10 $$;
create or replace function points_top_scorer()           returns integer language sql immutable as $$ select 15 $$;
create or replace function points_dark_horse()           returns integer language sql immutable as $$ select 10 $$;
create or replace function points_player_prop()          returns integer language sql immutable as $$ select 10 $$;

-- ---------------------------------------------------------------------------
-- score_match(match_id) — award 1X2 points for one finished match
-- ---------------------------------------------------------------------------

create or replace function score_match(p_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m matches%rowtype;
  awarded integer := 0;
begin
  select * into m from matches where id = p_match_id;
  if not found or m.status <> 'FINISHED' or m.winner is null then
    return 0;
  end if;

  insert into point_awards (user_id, prediction_type, prediction_ref, match_id, points, idempotency_key)
  select
    mp.user_id,
    'match'::prediction_type,
    mp.id,
    mp.match_id,
    points_match_1x2(),
    'match:' || mp.user_id::text || ':' || mp.match_id::text
  from match_predictions mp
  where mp.match_id = p_match_id
    and mp.pick::text = m.winner::text
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_bracket() — award bracket points for any slot whose match is FINISHED
-- A bracket prediction is correct iff the predicted team actually won the
-- match assigned to that bracket_slot.
-- ---------------------------------------------------------------------------

create or replace function score_bracket()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded integer := 0;
begin
  insert into point_awards (user_id, prediction_type, prediction_ref, match_id, points, idempotency_key)
  select
    bp.user_id,
    'bracket'::prediction_type,
    bp.id,
    m.id,
    points_bracket_slot(bp.bracket_slot),
    'bracket:' || bp.user_id::text || ':' || bp.bracket_slot
  from bracket_predictions bp
  join matches m on m.bracket_slot = bp.bracket_slot
  where m.status = 'FINISHED'
    and m.winner is not null
    and (
      (m.winner = 'HOME' and m.home_team_id = bp.team_id)
      or (m.winner = 'AWAY' and m.away_team_id = bp.team_id)
    )
  on conflict (idempotency_key) do nothing;

  -- Special slot 'W' (overall winner) — match is the Final
  insert into point_awards (user_id, prediction_type, prediction_ref, match_id, points, idempotency_key)
  select
    bp.user_id,
    'bracket'::prediction_type,
    bp.id,
    m.id,
    points_bracket_slot('W'),
    'bracket:' || bp.user_id::text || ':W'
  from bracket_predictions bp
  join matches m on m.bracket_slot = 'F'
  where bp.bracket_slot = 'W'
    and m.status = 'FINISHED'
    and m.winner is not null
    and (
      (m.winner = 'HOME' and m.home_team_id = bp.team_id)
      or (m.winner = 'AWAY' and m.away_team_id = bp.team_id)
    )
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_tournament() — award winner / runner-up / golden boot / dark horse
-- Only runs once the final is FINISHED. Idempotent.
-- ---------------------------------------------------------------------------

create or replace function score_tournament()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  final_match matches%rowtype;
  winner_team_id uuid;
  runner_up_team_id uuid;
  top_scorer_ids uuid[];
  sf_team_ids uuid[];
  awarded integer := 0;
begin
  select * into final_match from matches where bracket_slot = 'F' limit 1;
  if not found or final_match.status <> 'FINISHED' or final_match.winner is null then
    return 0;
  end if;

  if final_match.winner = 'HOME' then
    winner_team_id := final_match.home_team_id;
    runner_up_team_id := final_match.away_team_id;
  else
    winner_team_id := final_match.away_team_id;
    runner_up_team_id := final_match.home_team_id;
  end if;

  -- Tournament winner
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_tournament_winner(),
         'tournament:winner:' || tp.user_id::text
  from tournament_predictions tp
  where tp.winner_team_id = winner_team_id
  on conflict (idempotency_key) do nothing;

  -- Runner-up
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_tournament_runner_up(),
         'tournament:runner_up:' || tp.user_id::text
  from tournament_predictions tp
  where tp.runner_up_team_id = runner_up_team_id
  on conflict (idempotency_key) do nothing;

  -- Dark horse — defined as "team reached the semis"
  select array_agg(distinct team_id) into sf_team_ids from (
    select home_team_id as team_id from matches where stage = 'SF' and home_team_id is not null
    union
    select away_team_id from matches where stage = 'SF' and away_team_id is not null
  ) s;

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_dark_horse(),
         'tournament:dark_horse:' || tp.user_id::text
  from tournament_predictions tp
  where tp.dark_horse_team_id = any(sf_team_ids)
  on conflict (idempotency_key) do nothing;

  -- Top scorer — tie policy: all tied users score
  with goals as (
    select pa.player_id, count(*) as goals
    from player_goal_log pa
    group by pa.player_id
  ),
  top as (
    select player_id from goals where goals = (select max(goals) from goals)
  )
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_top_scorer(),
         'tournament:top_scorer:' || tp.user_id::text
  from tournament_predictions tp
  join top on top.player_id = tp.top_scorer_player_id
  on conflict (idempotency_key) do nothing;

  -- Player props (per prop_key; the resolved correct player lives in player_prop_resolutions)
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select ppp.user_id, 'prop', ppp.id, points_player_prop(),
         'prop:' || ppp.user_id::text || ':' || ppp.prop_key
  from player_prop_predictions ppp
  join player_prop_resolutions ppr on ppr.prop_key = ppp.prop_key
  where ppp.player_id = ppr.player_id
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- Supporting tables for top_scorer / player props resolution.
-- player_goal_log: one row per goal scored (populated by the sync job after each match).
create table if not exists player_goal_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  match_id uuid not null references matches(id) on delete cascade,
  minute integer,
  recorded_at timestamptz not null default now(),
  unique (player_id, match_id, minute)
);

create index if not exists pgl_player_idx on player_goal_log (player_id);

alter table player_goal_log enable row level security;
drop policy if exists "pgl_read" on player_goal_log;
create policy "pgl_read" on player_goal_log for select to authenticated using (true);

-- player_prop_resolutions: admin sets these once a prop resolves.
create table if not exists player_prop_resolutions (
  prop_key text primary key,
  player_id uuid not null references players(id) on delete cascade,
  resolved_at timestamptz not null default now()
);

alter table player_prop_resolutions enable row level security;
drop policy if exists "ppr_read" on player_prop_resolutions;
create policy "ppr_read" on player_prop_resolutions for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Leaderboard materialized view
-- ---------------------------------------------------------------------------

create materialized view if not exists league_standings as
select
  lm.league_id,
  p.id as user_id,
  p.username,
  p.display_name,
  coalesce(sum(case when pa.prediction_type = 'match' then pa.points end), 0)::int as match_points,
  coalesce(sum(case when pa.prediction_type = 'bracket' then pa.points end), 0)::int as bracket_points,
  coalesce(sum(case when pa.prediction_type = 'tournament' then pa.points end), 0)::int as tournament_points,
  coalesce(sum(case when pa.prediction_type = 'prop' then pa.points end), 0)::int as prop_points,
  coalesce(sum(pa.points), 0)::int as total_points
from league_members lm
join profiles p on p.id = lm.user_id
left join point_awards pa on pa.user_id = p.id
group by lm.league_id, p.id, p.username, p.display_name;

create unique index if not exists league_standings_pk on league_standings (league_id, user_id);
create index if not exists league_standings_total_idx on league_standings (league_id, total_points desc);

create or replace function refresh_league_standings()
returns void
language sql
security definer
as $$
  refresh materialized view concurrently league_standings;
$$;
