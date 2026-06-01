-- World Cup 2026 Bet Game — make scoring reconcile instead of insert-only.
--
-- Problem
-- -------
-- Every scorer inserts with `on conflict (idempotency_key) do nothing`, and the
-- idempotency_key encodes only the (user, target) pair — never the *result*
-- (winner / advancing team / closest guess). So once an award exists, flipping
-- the underlying result never corrects it:
--   * Admin corrects a match score (lib/admin/actions.ts overrideMatchResult)
--     and the winner flips → the user who was right under the OLD winner keeps
--     their award (re-running score_match skips them), and the user right under
--     the NEW winner also gets one. The leaderboard is permanently inflated.
--   * The same bites a normal syncFixtures run if football-data revises an
--     already-FINISHED result.
-- score_bracket / score_tournament (and its sub-scorers) share the blind spot.
--
-- Fix
-- ---
-- Each scorer first DELETEs the awards it owns that no longer reflect the
-- current result, then re-INSERTs the correct set (still `on conflict do
-- nothing`). The delete is a "stale-only" predicate — when nothing changed it
-- removes zero rows and the insert is a no-op, so the functions stay idempotent
-- (re-running every 10 min via cron is free). When a result flips, the now-wrong
-- award is removed and the now-correct one inserted. Both overrideMatchResult
-- and syncFixtures already call refresh_league_standings() afterwards, so the
-- materialized standings pick up the corrected totals on the next refresh.
--
-- Point values are UNCHANGED — this migration only changes which rows survive,
-- not how many points each is worth. The points-sync invariant with
-- lib/scoring/rules.ts holds.
--
-- Out of scope (documented limitation): score_group_winner() and
-- score_first_eliminated() use one-shot bookkeeping rows (group_settlements /
-- first_elimination) that gate recomputation entirely, so a group-stage result
-- corrected *after* its group settled won't re-settle. Healing those requires
-- invalidating the settlement row — a separate mechanism left for a follow-up.

-- ---------------------------------------------------------------------------
-- score_match(match_id) — reconcile 1X2 awards for one match.
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
  if not found then
    return 0;
  end if;

  -- Match has no (longer a) decided result: drop every 1X2 award we handed out
  -- for it. Covers a FINISHED → POSTPONED/SCHEDULED reversal.
  if m.status <> 'FINISHED' or m.winner is null then
    delete from point_awards
    where match_id = p_match_id and prediction_type = 'match';
    return 0;
  end if;

  -- Drop awards whose underlying pick no longer matches the current winner
  -- (winner flipped) or whose prediction row is gone (pick cleared).
  delete from point_awards pa
  where pa.match_id = p_match_id
    and pa.prediction_type = 'match'
    and not exists (
      select 1 from match_predictions mp
      where mp.id = pa.prediction_ref
        and mp.pick::text = m.winner::text
    );

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
-- score_bracket() — reconcile bracket awards across all slots.
-- A bracket pick is correct iff its slot's match (the Final for the 'W' slot)
-- is FINISHED and the picked team is the one that advanced.
-- ---------------------------------------------------------------------------

create or replace function score_bracket()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  awarded integer := 0;
  delta integer := 0;
begin
  -- Drop bracket awards whose slot result has since changed (a knockout winner
  -- flipped, so the predicted team no longer advanced) or whose pick is gone.
  -- The CASE join resolves 'W' to the Final slot 'F'; every other slot maps to
  -- its own match.
  delete from point_awards pa
  where pa.prediction_type = 'bracket'
    and not exists (
      select 1
      from bracket_predictions bp
      join matches m
        on m.bracket_slot = case when bp.bracket_slot = 'W' then 'F' else bp.bracket_slot end
      where bp.id = pa.prediction_ref
        and m.status = 'FINISHED'
        and m.winner is not null
        and (
          (m.winner = 'HOME' and m.home_team_id = bp.team_id)
          or (m.winner = 'AWAY' and m.away_team_id = bp.team_id)
        )
    );

  -- Per-slot stages: R32, R16, QF, SF, F.
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
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  -- Special slot 'W' (overall champion) — match is the Final.
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
  get diagnostics delta = row_count;
  awarded := awarded + delta;

  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_total_goals_guess() — reconcile then award. Single closest guess wins;
-- ties split the base. Both the winning set AND the per-user split can change
-- when the actual total moves, so the stale-check also compares points.
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

  if min_delta is null then
    delete from point_awards where idempotency_key like 'tournament:total_goals:%';
    return 0;
  end if;

  select count(*) into n_tied
    from tournament_predictions
    where total_goals_guess is not null
      and abs(total_goals_guess - actual) = min_delta;

  per_user := greatest(1, (points_total_goals_base() / n_tied)::int);

  -- Drop awards for users who are no longer closest, or whose split changed.
  delete from point_awards pa
  where pa.idempotency_key like 'tournament:total_goals:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'tournament:total_goals:' || tp.user_id::text
        and tp.total_goals_guess is not null
        and abs(tp.total_goals_guess - actual) = min_delta
        and pa.points = per_user
    );

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
-- score_highest_match_goals_guess() — same shape against the single highest
-- match goal count over FINISHED matches.
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

  if min_delta is null then
    delete from point_awards where idempotency_key like 'tournament:highest_match:%';
    return 0;
  end if;

  select count(*) into n_tied
    from tournament_predictions
    where highest_match_goals_guess is not null
      and abs(highest_match_goals_guess - actual) = min_delta;

  per_user := greatest(1, (points_highest_match_base() / n_tied)::int);

  delete from point_awards pa
  where pa.idempotency_key like 'tournament:highest_match:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'tournament:highest_match:' || tp.user_id::text
        and tp.highest_match_goals_guess is not null
        and abs(tp.highest_match_goals_guess - actual) = min_delta
        and pa.points = per_user
    );

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
-- score_troublemaker() — reconcile then award. Player(s) with most card weight
-- (Y=1, R=2, YELLOW_RED=1); all tied players' pickers win full points.
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

  -- Drop awards for pickers whose player is no longer (tied for) most-carded.
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
  delete from point_awards pa
  where pa.idempotency_key like 'tournament:troublemaker:%'
    and not exists (
      select 1
      from player_prop_predictions ppp
      join top on top.player_id = ppp.player_id
      where ppp.prop_key = 'troublemaker'
        and pa.idempotency_key = 'tournament:troublemaker:' || ppp.user_id::text
    );

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
-- score_tournament() — reconcile + award winner / runner-up / dark horse /
-- top scorer / player props, then chain the reconciling sub-scorers. Dark horse
-- pays the picked team's fifa_ranking if it reached QF (value can change, so the
-- stale-check compares points too).
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

  -- Tournament winner — reconcile then award.
  delete from point_awards pa
  where pa.idempotency_key like 'tournament:winner:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'tournament:winner:' || tp.user_id::text
        and tp.winner_team_id = v_winner_team_id
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_tournament_winner(),
         'tournament:winner:' || tp.user_id::text
  from tournament_predictions tp
  where tp.winner_team_id = v_winner_team_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- Runner-up — reconcile then award.
  delete from point_awards pa
  where pa.idempotency_key like 'tournament:runner_up:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'tournament:runner_up:' || tp.user_id::text
        and tp.runner_up_team_id = v_runner_up_team_id
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, points_tournament_runner_up(),
         'tournament:runner_up:' || tp.user_id::text
  from tournament_predictions tp
  where tp.runner_up_team_id = v_runner_up_team_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- Dark horse: points = fifa_ranking if the pick reached QF. Reconcile drops
  -- awards whose team didn't reach QF (or whose ranking value changed).
  select array_agg(distinct team_id) into qf_team_ids from (
    select home_team_id as team_id from matches where stage = 'QF' and home_team_id is not null
    union
    select away_team_id from matches where stage = 'QF' and away_team_id is not null
  ) s;

  delete from point_awards pa
  where pa.idempotency_key like 'tournament:dark_horse:%'
    and not exists (
      select 1 from tournament_predictions tp
      join teams t on t.id = tp.dark_horse_team_id
      where pa.idempotency_key = 'tournament:dark_horse:' || tp.user_id::text
        and tp.dark_horse_team_id = any(qf_team_ids)
        and t.fifa_ranking is not null
        and pa.points = t.fifa_ranking
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, t.fifa_ranking,
         'tournament:dark_horse:' || tp.user_id::text
  from tournament_predictions tp
  join teams t on t.id = tp.dark_horse_team_id
  where tp.dark_horse_team_id = any(qf_team_ids)
    and t.fifa_ranking is not null
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- Top scorer (ties all win) — reconcile then award.
  with goals as (
    select pa.player_id, count(*) as goals
    from player_goal_log pa
    group by pa.player_id
  ),
  top as (
    select player_id from goals where goals = (select max(goals) from goals)
  )
  delete from point_awards pa
  where pa.idempotency_key like 'tournament:top_scorer:%'
    and not exists (
      select 1 from tournament_predictions tp
      join top on top.player_id = tp.top_scorer_player_id
      where pa.idempotency_key = 'tournament:top_scorer:' || tp.user_id::text
    );
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

  -- Player props (admin-resolved via player_prop_resolutions) — reconcile then
  -- award, so a changed resolution moves the points to the right pickers.
  delete from point_awards pa
  where pa.prediction_type = 'prop'
    and pa.idempotency_key like 'prop:%'
    and not exists (
      select 1
      from player_prop_predictions ppp
      join player_prop_resolutions ppr on ppr.prop_key = ppp.prop_key
      where pa.idempotency_key = 'prop:' || ppp.user_id::text || ':' || ppp.prop_key
        and ppp.player_id = ppr.player_id
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select ppp.user_id, 'prop', ppp.id, points_player_prop(),
         'prop:' || ppp.user_id::text || ':' || ppp.prop_key
  from player_prop_predictions ppp
  join player_prop_resolutions ppr on ppr.prop_key = ppp.prop_key
  where ppp.player_id = ppr.player_id
  on conflict (idempotency_key) do nothing;
  get diagnostics delta = row_count; awarded := awarded + delta;

  -- Tournament-wide props (each reconciles internally)
  awarded := awarded + score_total_goals_guess();
  awarded := awarded + score_highest_match_goals_guess();
  awarded := awarded + score_troublemaker();

  return awarded;
end;
$$;
