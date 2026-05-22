-- World Cup 2026 Bet Game — additional tournament-wide prediction types.
--
-- Adds five new "season-long" bets and rewrites the dark-horse scoring:
--   * Dark horse: points = team's fifa_ranking (1..48) if the team reaches QF.
--     Old rule (10 pts flat for reaching SF) is replaced. The TS canon for
--     ranks lives in lib/scoring/fifa-rankings.ts; the UPDATE block at the
--     bottom of this file seeds teams.fifa_ranking from that source.
--   * Total goals (whole tournament): single closest guess wins, ties split
--     points_total_goals_base() (20) by tied user count.
--   * Highest-scoring match (goal count): same shape, base 15.
--   * Troublemaker (player with most card weight, Y=1 / R=2 / YELLOW_RED=1):
--     all tied players' pickers win 15 pts.
--   * Group winners: per-group, when the group's last match is FINISHED.
--     5 pts per correct group (max 60 across 12 groups).
--   * First team eliminated: first team mathematically out of group top-2.
--     10 pts.
--
-- Point constants must stay in sync with POINTS.tournament in
-- lib/scoring/rules.ts — see lib/scoring/CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

alter table teams
  add column if not exists fifa_ranking integer
  check (fifa_ranking is null or fifa_ranking between 1 and 48);
create index if not exists teams_fifa_ranking_idx on teams (fifa_ranking);

alter table tournament_predictions
  add column if not exists total_goals_guess integer
    check (total_goals_guess is null or total_goals_guess between 0 and 300),
  add column if not exists highest_match_goals_guess integer
    check (highest_match_goals_guess is null or highest_match_goals_guess between 0 and 30),
  add column if not exists first_eliminated_team_id uuid references teams(id);

-- Marker for "we've already fetched per-match details (bookings, goals) for
-- this match from football-data.org". syncFixtures drains FINISHED matches
-- with NULL here at a small batch per run to stay under the 10 req/min cap.
alter table matches
  add column if not exists details_synced_at timestamptz;
create index if not exists matches_details_pending_idx
  on matches (status, details_synced_at)
  where status = 'FINISHED' and details_synced_at is null;

create table if not exists group_winner_predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  group_letter char(1) not null check (group_letter between 'A' and 'L'),
  team_id uuid not null references teams(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  unique (user_id, group_letter)
);
create index if not exists gwp_user_idx on group_winner_predictions (user_id);

create table if not exists player_card_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  match_id  uuid not null references matches(id)  on delete cascade,
  minute integer,
  card_type text not null check (card_type in ('YELLOW','RED','YELLOW_RED')),
  recorded_at timestamptz not null default now(),
  unique (player_id, match_id, minute, card_type)
);
create index if not exists pcl_player_idx on player_card_log (player_id);

create table if not exists group_settlements (
  group_letter char(1) primary key,
  winner_team_id uuid references teams(id),
  settled_at timestamptz not null default now()
);

create table if not exists first_elimination (
  id integer primary key default 1 check (id = 1),
  team_id uuid references teams(id),
  detected_at timestamptz
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table group_winner_predictions enable row level security;
alter table player_card_log enable row level security;
alter table group_settlements enable row level security;
alter table first_elimination enable row level security;

drop policy if exists "gwp_read_self" on group_winner_predictions;
create policy "gwp_read_self" on group_winner_predictions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "gwp_read_after_lock" on group_winner_predictions;
create policy "gwp_read_after_lock" on group_winner_predictions
  for select to authenticated using (
    round1_locked() and exists (
      select 1 from league_members lm_self
      join league_members lm_other on lm_other.league_id = lm_self.league_id
      where lm_self.user_id = auth.uid() and lm_other.user_id = group_winner_predictions.user_id
    )
  );

drop policy if exists "gwp_write_self" on group_winner_predictions;
create policy "gwp_write_self" on group_winner_predictions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "pcl_read" on player_card_log;
create policy "pcl_read" on player_card_log for select to authenticated using (true);

drop policy if exists "gs_read" on group_settlements;
create policy "gs_read" on group_settlements for select to authenticated using (true);

drop policy if exists "fe_read" on first_elimination;
create policy "fe_read" on first_elimination for select to authenticated using (true);

-- Lock trigger — same shape as tournament_predictions: round 1 lock.
drop trigger if exists group_winner_predictions_lock on group_winner_predictions;
create trigger group_winner_predictions_lock
  before insert or update on group_winner_predictions
  for each row execute function enforce_round1_lock();

-- ---------------------------------------------------------------------------
-- Point constants (kept in sync with POINTS.tournament in lib/scoring/rules.ts)
-- ---------------------------------------------------------------------------

create or replace function points_total_goals_base()    returns integer language sql immutable as $$ select 20 $$;
create or replace function points_highest_match_base()  returns integer language sql immutable as $$ select 15 $$;
create or replace function points_troublemaker()        returns integer language sql immutable as $$ select 15 $$;
create or replace function points_group_winner()        returns integer language sql immutable as $$ select 5  $$;
create or replace function points_first_eliminated()    returns integer language sql immutable as $$ select 10 $$;

-- ---------------------------------------------------------------------------
-- score_total_goals_guess() — single closest guess wins, ties split the base.
-- Per-user points = floor(base / n_tied), at least 1.
-- ---------------------------------------------------------------------------

create or replace function score_total_goals_guess()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actual int;
  min_delta int;
  n_tied int;
  per_user int;
  awarded int := 0;
begin
  if not exists (select 1 from matches where bracket_slot = 'F' and status = 'FINISHED') then
    return 0;
  end if;

  select coalesce(sum(coalesce(home_score, 0) + coalesce(away_score, 0)), 0)
    into actual
    from matches where status = 'FINISHED';

  select min(abs(total_goals_guess - actual))
    into min_delta
    from tournament_predictions where total_goals_guess is not null;
  if min_delta is null then return 0; end if;

  select count(*) into n_tied
    from tournament_predictions
    where total_goals_guess is not null
      and abs(total_goals_guess - actual) = min_delta;

  per_user := greatest(1, (points_total_goals_base() / n_tied)::int);

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, per_user,
         'tournament:total_goals:' || tp.user_id::text
  from tournament_predictions tp
  where tp.total_goals_guess is not null
    and abs(tp.total_goals_guess - actual) = min_delta
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_highest_match_goals_guess() — same shape against
-- max(home_score + away_score) over FINISHED matches.
-- ---------------------------------------------------------------------------

create or replace function score_highest_match_goals_guess()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  actual int;
  min_delta int;
  n_tied int;
  per_user int;
  awarded int := 0;
begin
  if not exists (select 1 from matches where bracket_slot = 'F' and status = 'FINISHED') then
    return 0;
  end if;

  select coalesce(max(coalesce(home_score, 0) + coalesce(away_score, 0)), 0)
    into actual
    from matches where status = 'FINISHED';

  select min(abs(highest_match_goals_guess - actual))
    into min_delta
    from tournament_predictions where highest_match_goals_guess is not null;
  if min_delta is null then return 0; end if;

  select count(*) into n_tied
    from tournament_predictions
    where highest_match_goals_guess is not null
      and abs(highest_match_goals_guess - actual) = min_delta;

  per_user := greatest(1, (points_highest_match_base() / n_tied)::int);

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, per_user,
         'tournament:highest_match:' || tp.user_id::text
  from tournament_predictions tp
  where tp.highest_match_goals_guess is not null
    and abs(tp.highest_match_goals_guess - actual) = min_delta
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_troublemaker() — player with most card weight (Y=1, R=2, YELLOW_RED=1).
-- All tied players' pickers win full points (mirrors top-scorer tie policy).
-- ---------------------------------------------------------------------------

create or replace function score_troublemaker()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded int := 0;
begin
  if not exists (select 1 from matches where bracket_slot = 'F' and status = 'FINISHED') then
    return 0;
  end if;

  with tallies as (
    select player_id,
      sum(case card_type
            when 'YELLOW'     then 1
            when 'YELLOW_RED' then 1
            when 'RED'        then 2
            else 0
          end) as card_pts
    from player_card_log
    group by player_id
  ),
  top as (
    select player_id from tallies
    where card_pts = (select max(card_pts) from tallies)
  )
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select ppp.user_id, 'tournament', ppp.id, points_troublemaker(),
         'tournament:troublemaker:' || ppp.user_id::text
  from player_prop_predictions ppp
  join top on top.player_id = ppp.player_id
  where ppp.prop_key = 'troublemaker'
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_group_winner(p_group) — settle one group when all 3 of its matches
-- are FINISHED. Tiebreaker: pts → GD → GF → team_id (deterministic fallback).
-- Idempotent via group_settlements row + idempotency_key.
-- ---------------------------------------------------------------------------

create or replace function score_group_winner(p_group char(1))
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner_team_id uuid;
  v_remaining int;
  awarded int := 0;
begin
  if exists (select 1 from group_settlements where group_letter = p_group) then
    return 0;
  end if;

  select count(*) into v_remaining
    from matches
    where group_letter = p_group and stage = 'GROUP' and status <> 'FINISHED';
  if v_remaining > 0 then return 0; end if;

  with results as (
    select m.home_team_id as team_id,
      case when m.winner = 'HOME' then 3 when m.winner = 'DRAW' then 1 else 0 end as pts,
      coalesce(m.home_score, 0) - coalesce(m.away_score, 0) as gd,
      coalesce(m.home_score, 0) as gf
    from matches m
    where m.group_letter = p_group and m.stage = 'GROUP' and m.status = 'FINISHED'
      and m.home_team_id is not null
    union all
    select m.away_team_id,
      case when m.winner = 'AWAY' then 3 when m.winner = 'DRAW' then 1 else 0 end,
      coalesce(m.away_score, 0) - coalesce(m.home_score, 0),
      coalesce(m.away_score, 0)
    from matches m
    where m.group_letter = p_group and m.stage = 'GROUP' and m.status = 'FINISHED'
      and m.away_team_id is not null
  ),
  standings as (
    select team_id, sum(pts) as pts, sum(gd) as gd, sum(gf) as gf
    from results
    group by team_id
  )
  select team_id into v_winner_team_id
  from standings
  order by pts desc, gd desc, gf desc, team_id
  limit 1;

  if v_winner_team_id is null then return 0; end if;

  insert into group_settlements (group_letter, winner_team_id, settled_at)
  values (p_group, v_winner_team_id, now())
  on conflict (group_letter) do nothing;

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select gwp.user_id, 'tournament', gwp.id, points_group_winner(),
         'tournament:group_winner:' || p_group || ':' || gwp.user_id::text
  from group_winner_predictions gwp
  where gwp.group_letter = p_group and gwp.team_id = v_winner_team_id
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_first_eliminated() — first team mathematically out of group top-2.
-- Definition: a team X is eliminated from top-2 when at least 2 other teams
-- in its group already have current_pts > X's max_possible_pts. This is an
-- approximation — WC 2026 also advances 8 best 3rd-placed teams, so being
-- 3rd in the group is not always elimination from the tournament. See
-- supabase/migrations/CLAUDE.md (risks/known gotchas).
-- Idempotent via first_elimination row + idempotency_key.
-- ---------------------------------------------------------------------------

create or replace function score_first_eliminated()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  awarded int := 0;
begin
  if exists (select 1 from first_elimination where id = 1 and team_id is not null) then
    return 0;
  end if;

  with team_match as (
    select t.id as team_id, t.group_letter,
      case
        when m.status = 'FINISHED' and m.winner = 'HOME' and m.home_team_id = t.id then 3
        when m.status = 'FINISHED' and m.winner = 'AWAY' and m.away_team_id = t.id then 3
        when m.status = 'FINISHED' and m.winner = 'DRAW' and (m.home_team_id = t.id or m.away_team_id = t.id) then 1
        else 0
      end as pts_this,
      (m.status = 'FINISHED' and (m.home_team_id = t.id or m.away_team_id = t.id))::int as played_this,
      (m.id is not null and (m.home_team_id = t.id or m.away_team_id = t.id))::int as sched_this,
      case when m.status = 'FINISHED' and (m.home_team_id = t.id or m.away_team_id = t.id)
           then m.finished_at end as finished_this
    from teams t
    left join matches m on m.stage = 'GROUP' and (m.home_team_id = t.id or m.away_team_id = t.id)
    where t.group_letter is not null
  ),
  per_team as (
    select team_id, group_letter,
      coalesce(sum(pts_this), 0) as pts,
      coalesce(sum(played_this), 0) as games_played,
      coalesce(sum(sched_this), 0) as games_total,
      max(finished_this) as last_finished_at
    from team_match
    group by team_id, group_letter
  ),
  per_team_max as (
    select pt.*, pt.pts + 3 * (pt.games_total - pt.games_played) as max_pts
    from per_team pt
  ),
  candidates as (
    select pmx.team_id, pmx.group_letter, pmx.last_finished_at
    from per_team_max pmx
    where (
      select count(*) from per_team_max o
      where o.group_letter = pmx.group_letter
        and o.team_id <> pmx.team_id
        and o.pts > pmx.max_pts
    ) >= 2
  )
  select team_id into v_team_id
  from candidates
  order by last_finished_at asc nulls last
  limit 1;

  if v_team_id is null then return 0; end if;

  insert into first_elimination (id, team_id, detected_at)
  values (1, v_team_id, now())
  on conflict (id) do update
    set team_id = excluded.team_id, detected_at = excluded.detected_at
    where first_elimination.team_id is null;

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_first_eliminated(),
         'tournament:first_elim:' || tp.user_id::text
  from tournament_predictions tp
  where tp.first_eliminated_team_id = v_team_id
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- settle_group_stage_props() — driver called from syncFixtures after every
-- match upsert. Cheap when there's nothing to do (guarded by bookkeeping rows).
-- ---------------------------------------------------------------------------

create or replace function settle_group_stage_props()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g char(1);
begin
  perform score_first_eliminated();
  for g in
    select distinct group_letter from matches
    where stage = 'GROUP' and group_letter is not null
      and not exists (select 1 from group_settlements gs where gs.group_letter = matches.group_letter)
  loop
    perform score_group_winner(g);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_tournament() — REWRITE: dark horse now scores teams.fifa_ranking
-- (1..48) if the picked team reached QF. Adds calls to score_total_goals_guess,
-- score_highest_match_goals_guess, and score_troublemaker.
-- ---------------------------------------------------------------------------

create or replace function score_tournament()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  final_match matches%rowtype;
  v_winner_team_id uuid;
  v_runner_up_team_id uuid;
  qf_team_ids uuid[];
  awarded int := 0;
  delta int := 0;
begin
  select * into final_match from matches where bracket_slot = 'F' limit 1;
  if not found or final_match.status <> 'FINISHED' or final_match.winner is null then
    return 0;
  end if;

  if final_match.winner = 'HOME' then
    v_winner_team_id    := final_match.home_team_id;
    v_runner_up_team_id := final_match.away_team_id;
  else
    v_winner_team_id    := final_match.away_team_id;
    v_runner_up_team_id := final_match.home_team_id;
  end if;

  -- Tournament winner
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_tournament_winner(),
         'tournament:winner:' || tp.user_id::text
  from tournament_predictions tp
  where tp.winner_team_id = v_winner_team_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- Runner-up
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_tournament_runner_up(),
         'tournament:runner_up:' || tp.user_id::text
  from tournament_predictions tp
  where tp.runner_up_team_id = v_runner_up_team_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- Dark horse: points = fifa_ranking if pick reached QF (replaces the old
  -- 10-pts-for-reaching-SF rule). Picking the worst-ranked team that makes
  -- QF wins the most points; favourites win least.
  select array_agg(distinct team_id) into qf_team_ids from (
    select home_team_id as team_id from matches where stage = 'QF' and home_team_id is not null
    union
    select away_team_id from matches where stage = 'QF' and away_team_id is not null
  ) s;

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, t.fifa_ranking,
         'tournament:dark_horse:' || tp.user_id::text
  from tournament_predictions tp
  join teams t on t.id = tp.dark_horse_team_id
  where tp.dark_horse_team_id = any(qf_team_ids)
    and t.fifa_ranking is not null
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- Top scorer (ties all win)
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
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- Player props (admin-resolved via player_prop_resolutions)
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select ppp.user_id, 'prop', ppp.id, points_player_prop(),
         'prop:' || ppp.user_id::text || ':' || ppp.prop_key
  from player_prop_predictions ppp
  join player_prop_resolutions ppr on ppr.prop_key = ppp.prop_key
  where ppp.player_id = ppr.player_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- New tournament-wide props
  awarded := awarded + score_total_goals_guess();
  awarded := awarded + score_highest_match_goals_guess();
  awarded := awarded + score_troublemaker();

  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- FIFA ranking seed (mirrors lib/scoring/fifa-rankings.ts).
-- UPDATE-by-code is idempotent — re-running is a no-op for non-matching codes.
-- TODO: confirm exact ranks closer to kickoff; teams that don't end up
-- qualifying will simply remain NULL and score 0 for dark-horse picks.
-- ---------------------------------------------------------------------------

update teams set fifa_ranking =  1 where code = 'ARG';
update teams set fifa_ranking =  2 where code = 'FRA';
update teams set fifa_ranking =  3 where code = 'ESP';
update teams set fifa_ranking =  4 where code = 'ENG';
update teams set fifa_ranking =  5 where code = 'BRA';
update teams set fifa_ranking =  6 where code = 'NED';
update teams set fifa_ranking =  7 where code = 'POR';
update teams set fifa_ranking =  8 where code = 'BEL';
update teams set fifa_ranking =  9 where code = 'GER';
update teams set fifa_ranking = 10 where code = 'CRO';
update teams set fifa_ranking = 11 where code = 'COL';
update teams set fifa_ranking = 12 where code = 'URU';
update teams set fifa_ranking = 13 where code = 'JPN';
update teams set fifa_ranking = 14 where code = 'MAR';
update teams set fifa_ranking = 15 where code = 'USA';
update teams set fifa_ranking = 16 where code = 'SUI';
update teams set fifa_ranking = 17 where code = 'SEN';
update teams set fifa_ranking = 18 where code = 'MEX';
update teams set fifa_ranking = 19 where code = 'IRN';
update teams set fifa_ranking = 20 where code = 'DEN';
update teams set fifa_ranking = 21 where code = 'KOR';
update teams set fifa_ranking = 22 where code = 'AUT';
update teams set fifa_ranking = 23 where code = 'AUS';
update teams set fifa_ranking = 24 where code = 'ECU';
update teams set fifa_ranking = 25 where code = 'UKR';
update teams set fifa_ranking = 26 where code = 'CRC';
update teams set fifa_ranking = 27 where code = 'CIV';
update teams set fifa_ranking = 28 where code = 'POL';
update teams set fifa_ranking = 29 where code = 'EGY';
update teams set fifa_ranking = 30 where code = 'NOR';
update teams set fifa_ranking = 31 where code = 'NGA';
update teams set fifa_ranking = 32 where code = 'CAN';
update teams set fifa_ranking = 33 where code = 'ALG';
update teams set fifa_ranking = 34 where code = 'SCO';
update teams set fifa_ranking = 35 where code = 'SRB';
update teams set fifa_ranking = 36 where code = 'ROU';
update teams set fifa_ranking = 37 where code = 'CZE';
update teams set fifa_ranking = 38 where code = 'PAR';
update teams set fifa_ranking = 39 where code = 'QAT';
update teams set fifa_ranking = 40 where code = 'KSA';
update teams set fifa_ranking = 41 where code = 'SVK';
update teams set fifa_ranking = 42 where code = 'COD';
update teams set fifa_ranking = 43 where code = 'TUN';
update teams set fifa_ranking = 44 where code = 'JAM';
update teams set fifa_ranking = 45 where code = 'UZB';
update teams set fifa_ranking = 46 where code = 'JOR';
update teams set fifa_ranking = 47 where code = 'NZL';
update teams set fifa_ranking = 48 where code = 'CPV';
