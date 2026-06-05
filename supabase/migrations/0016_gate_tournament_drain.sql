-- World Cup 2026 Bet Game — defer drain-dependent tournament scorers (#83).
--
-- Top scorer and troublemaker are computed from player_goal_log / player_card_log,
-- which syncFixtures() populates via drainPendingMatchDetails() — capped at 5
-- matches per 10-min cron run to stay under football-data's 10 req/min free tier.
-- score_tournament() runs the instant the Final is FINISHED, so if earlier
-- finished matches' goals/cards are still in the drain backlog, these two
-- categories resolve on INCOMPLETE data right after the Final (the
-- highest-visibility moment of the tournament).
--
-- Fix: gate the top-scorer block (in score_tournament) and the whole of
-- score_troublemaker() on the drain being complete — i.e. no FINISHED match
-- still has details_synced_at IS NULL. Both are self-healing: score_tournament()
-- re-runs on every cron once the Final is FINISHED, so the gate opens
-- automatically once the drain catches up. The other tournament categories
-- (winner / runner-up / dark horse / player props / total goals / highest match)
-- don't read the detail logs and keep awarding immediately.
--
-- Migrations are append-only — this only `create or replace`s functions, no
-- schema change, so no `npm run db:types` regeneration is needed.

-- ---------------------------------------------------------------------------
-- Gate helper: true once every FINISHED match has had its per-match details
-- (goals + bookings) drained from football-data. Only meaningful after the
-- Final is FINISHED (the only point the gated scorers are consulted).
-- ---------------------------------------------------------------------------

create or replace function all_match_details_synced()
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from matches
    where status = 'FINISHED' and details_synced_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- score_troublemaker() — unchanged from 0014 except it now returns early (0)
-- until the match-detail drain is complete, so the most-carded player is
-- computed on the full set of bookings, never a partial backlog.
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

  -- Defer until every FINISHED match's cards are drained (see #83).
  if not all_match_details_synced() then
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
-- score_tournament() — unchanged from 0014 except the top-scorer reconcile +
-- award block is now wrapped in `if all_match_details_synced()`, so it only
-- resolves once every FINISHED match's goals are drained (see #83). Winner /
-- runner-up / dark horse / player props (and the chained total-goals /
-- highest-match / troublemaker sub-scorers) are otherwise identical.
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
  -- FINISHED match's goals are drained, so it never resolves on a partial
  -- backlog right after the Final (see #83). Skipping the reconcile-delete too
  -- is safe: with the gate always present, no top-scorer award is ever written
  -- on partial data, so there's nothing stale to revoke.
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

  return awarded;
end;
$$;
