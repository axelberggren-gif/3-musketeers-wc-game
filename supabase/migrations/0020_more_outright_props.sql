-- World Cup 2026 Bet Game — four more tournament-wide "outright" props.
--
-- Adds four numeric closest-guess bets to tournament_predictions, all scored
-- exactly like score_total_goals_guess() / score_highest_match_goals_guess()
-- (single closest guess wins; ties split the base; reconcile-then-insert so a
-- corrected result moves the points). Point bases must stay in sync with
-- POINTS.tournament in lib/scoring/rules.ts — see lib/scoring/CLAUDE.md.
--
--   * Goals in the Final        (final_goals_guess)        base 10.
--       actual = the Final match's home_score + away_score.
--   * Biggest win margin        (biggest_win_margin_guess) base 10.
--       actual = max |home_score - away_score| over FINISHED matches.
--   * Golden Boot tally         (golden_boot_goals_guess)  base 10.
--       actual = the top scorer's goal count (max goals per player in
--       player_goal_log). DRAIN-GATED (reads the goal log, populated by the
--       per-match detail drain) — mirrors the top-scorer gate from 0016.
--   * Total red cards           (total_red_cards_guess)    base 15.
--       actual = count of RED + YELLOW_RED in player_card_log. DRAIN-GATED.
--
-- All four guard on the Final being FINISHED (tournament-wide props only settle
-- once the tournament is decided), matching the existing two numeric props.
--
-- Migrations are append-only. This adds columns (run `npm run db:types` once the
-- dev DB has it; types are hand-edited here meanwhile) and `create or replace`s
-- score_tournament() — based on the 0016 version (the live one) — to chain the
-- four new reconciling sub-scorers after the existing ones.

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

alter table tournament_predictions
  add column if not exists final_goals_guess integer
    check (final_goals_guess is null or final_goals_guess between 0 and 30),
  add column if not exists biggest_win_margin_guess integer
    check (biggest_win_margin_guess is null or biggest_win_margin_guess between 0 and 30),
  add column if not exists golden_boot_goals_guess integer
    check (golden_boot_goals_guess is null or golden_boot_goals_guess between 0 and 30),
  add column if not exists total_red_cards_guess integer
    check (total_red_cards_guess is null or total_red_cards_guess between 0 and 200);

-- ---------------------------------------------------------------------------
-- Point constants (kept in sync with POINTS.tournament in lib/scoring/rules.ts)
-- ---------------------------------------------------------------------------

create or replace function points_final_goals_base()        returns integer language sql immutable as $$ select 10 $$;
create or replace function points_biggest_win_margin_base()  returns integer language sql immutable as $$ select 10 $$;
create or replace function points_golden_boot_goals_base()   returns integer language sql immutable as $$ select 10 $$;
create or replace function points_total_red_cards_base()     returns integer language sql immutable as $$ select 15 $$;

-- ---------------------------------------------------------------------------
-- score_final_goals_guess() — closest guess to the Final's goal count.
-- Single closest wins; ties split the base. Both the winning set AND the
-- per-user split can change if the Final score is corrected, so the stale-check
-- also compares points.
-- ---------------------------------------------------------------------------

create or replace function score_final_goals_guess()
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

  select coalesce(home_score, 0) + coalesce(away_score, 0)
    into actual
    from matches where bracket_slot = 'F' and status = 'FINISHED' limit 1;

  select min(abs(final_goals_guess - actual))
    into min_delta
    from tournament_predictions where final_goals_guess is not null;

  if min_delta is null then
    delete from point_awards where idempotency_key like 'tournament:final_goals:%';
    return 0;
  end if;

  select count(*) into n_tied
    from tournament_predictions
    where final_goals_guess is not null
      and abs(final_goals_guess - actual) = min_delta;

  per_user := greatest(1, (points_final_goals_base() / n_tied)::int);

  delete from point_awards pa
  where pa.idempotency_key like 'tournament:final_goals:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'tournament:final_goals:' || tp.user_id::text
        and tp.final_goals_guess is not null
        and abs(tp.final_goals_guess - actual) = min_delta
        and pa.points = per_user
    );

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, per_user,
         'tournament:final_goals:' || tp.user_id::text
  from tournament_predictions tp
  where tp.final_goals_guess is not null
    and abs(tp.final_goals_guess - actual) = min_delta
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_biggest_win_margin_guess() — closest guess to the largest goal margin
-- in any single FINISHED match.
-- ---------------------------------------------------------------------------

create or replace function score_biggest_win_margin_guess()
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

  select coalesce(max(abs(coalesce(home_score, 0) - coalesce(away_score, 0))), 0)
    into actual
    from matches where status = 'FINISHED';

  select min(abs(biggest_win_margin_guess - actual))
    into min_delta
    from tournament_predictions where biggest_win_margin_guess is not null;

  if min_delta is null then
    delete from point_awards where idempotency_key like 'tournament:win_margin:%';
    return 0;
  end if;

  select count(*) into n_tied
    from tournament_predictions
    where biggest_win_margin_guess is not null
      and abs(biggest_win_margin_guess - actual) = min_delta;

  per_user := greatest(1, (points_biggest_win_margin_base() / n_tied)::int);

  delete from point_awards pa
  where pa.idempotency_key like 'tournament:win_margin:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'tournament:win_margin:' || tp.user_id::text
        and tp.biggest_win_margin_guess is not null
        and abs(tp.biggest_win_margin_guess - actual) = min_delta
        and pa.points = per_user
    );

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, per_user,
         'tournament:win_margin:' || tp.user_id::text
  from tournament_predictions tp
  where tp.biggest_win_margin_guess is not null
    and abs(tp.biggest_win_margin_guess - actual) = min_delta
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_golden_boot_goals_guess() — closest guess to the top scorer's final
-- goal count (the max goals any single player has in player_goal_log).
-- DRAIN-GATED: returns 0 until every FINISHED match's goals are drained, so it
-- never settles on a partial backlog right after the Final (mirrors the
-- top-scorer gate in 0016). Nothing is ever written on partial data, so there
-- is nothing stale to revoke before the gate opens.
-- ---------------------------------------------------------------------------

create or replace function score_golden_boot_goals_guess()
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

  if not all_match_details_synced() then
    return 0;
  end if;

  select coalesce(max(g.goals), 0) into actual
    from (select count(*) as goals from player_goal_log group by player_id) g;

  select min(abs(golden_boot_goals_guess - actual))
    into min_delta
    from tournament_predictions where golden_boot_goals_guess is not null;

  if min_delta is null then
    delete from point_awards where idempotency_key like 'tournament:golden_boot_goals:%';
    return 0;
  end if;

  select count(*) into n_tied
    from tournament_predictions
    where golden_boot_goals_guess is not null
      and abs(golden_boot_goals_guess - actual) = min_delta;

  per_user := greatest(1, (points_golden_boot_goals_base() / n_tied)::int);

  delete from point_awards pa
  where pa.idempotency_key like 'tournament:golden_boot_goals:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'tournament:golden_boot_goals:' || tp.user_id::text
        and tp.golden_boot_goals_guess is not null
        and abs(tp.golden_boot_goals_guess - actual) = min_delta
        and pa.points = per_user
    );

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, per_user,
         'tournament:golden_boot_goals:' || tp.user_id::text
  from tournament_predictions tp
  where tp.golden_boot_goals_guess is not null
    and abs(tp.golden_boot_goals_guess - actual) = min_delta
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_total_red_cards_guess() — closest guess to the total red cards across
-- the tournament (RED + YELLOW_RED in player_card_log). DRAIN-GATED like the
-- golden-boot tally above (cards come from the per-match detail drain).
-- ---------------------------------------------------------------------------

create or replace function score_total_red_cards_guess()
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

  if not all_match_details_synced() then
    return 0;
  end if;

  select count(*) into actual
    from player_card_log where card_type in ('RED', 'YELLOW_RED');

  select min(abs(total_red_cards_guess - actual))
    into min_delta
    from tournament_predictions where total_red_cards_guess is not null;

  if min_delta is null then
    delete from point_awards where idempotency_key like 'tournament:red_cards:%';
    return 0;
  end if;

  select count(*) into n_tied
    from tournament_predictions
    where total_red_cards_guess is not null
      and abs(total_red_cards_guess - actual) = min_delta;

  per_user := greatest(1, (points_total_red_cards_base() / n_tied)::int);

  delete from point_awards pa
  where pa.idempotency_key like 'tournament:red_cards:%'
    and not exists (
      select 1 from tournament_predictions tp
      where pa.idempotency_key = 'tournament:red_cards:' || tp.user_id::text
        and tp.total_red_cards_guess is not null
        and abs(tp.total_red_cards_guess - actual) = min_delta
        and pa.points = per_user
    );

  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select tp.user_id, 'tournament', tp.user_id, per_user,
         'tournament:red_cards:' || tp.user_id::text
  from tournament_predictions tp
  where tp.total_red_cards_guess is not null
    and abs(tp.total_red_cards_guess - actual) = min_delta
  on conflict (idempotency_key) do nothing;

  get diagnostics awarded = row_count;
  return awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- score_tournament() — identical to the 0016 version (winner / runner-up /
-- dark horse / drain-gated top scorer / player props, then the chained
-- total-goals / highest-match / troublemaker sub-scorers) with the four new
-- outright sub-scorers appended. Each new scorer reconciles internally and the
-- goal/card-derived ones defer internally until the detail drain is complete.
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

  -- Top scorer (ties all win) — reconcile then award. Deferred until every
  -- FINISHED match's goals are drained (see #83).
  if all_match_details_synced() then
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
  end if;

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

  -- Tournament-wide props (each reconciles internally; troublemaker also
  -- defers internally until the card drain is complete).
  awarded := awarded + score_total_goals_guess();
  awarded := awarded + score_highest_match_goals_guess();
  awarded := awarded + score_troublemaker();

  -- New outright props (0020): final goals + biggest margin settle on scores;
  -- golden-boot tally + total red cards defer internally until the drain done.
  awarded := awarded + score_final_goals_guess();
  awarded := awarded + score_biggest_win_margin_guess();
  awarded := awarded + score_golden_boot_goals_guess();
  awarded := awarded + score_total_red_cards_guess();

  return awarded;
end;
$$;
