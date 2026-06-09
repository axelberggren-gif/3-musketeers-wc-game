-- 0028_fix_troublemaker_double_pay.sql
--
-- Fix a latent troublemaker double-pay inside score_tournament().
--
-- The troublemaker pick is stored as a player_prop_predictions row with
-- prop_key = 'troublemaker'. The dedicated score_troublemaker() (live body:
-- 0016_gate_tournament_drain.sql) pays it points_troublemaker() = 15 under
-- the 'tournament:troublemaker:<user>' key. But the GENERIC player-prop block
-- inside score_tournament() pays points_player_prop() = 10 to *any*
-- player_prop_predictions row whose prop_key has a matching
-- player_prop_resolutions row — so the moment anyone inserts a
-- player_prop_resolutions row with prop_key = 'troublemaker' (a future admin
-- resolutions UI, a well-meaning manual INSERT), every correct troublemaker
-- picker would ALSO collect 10 pts under the 'prop:<user>:troublemaker' key.
-- Nothing writes player_prop_resolutions today, so the bug is latent — but
-- armed.
--
-- Fix: re-create score_tournament() identical to the live 0020 body
-- (0020_more_outright_props.sql — the last definition; verified by grepping
-- every migration) with `ppp.prop_key <> 'troublemaker'` added to the generic
-- player-prop block — both in the reconcile-DELETE keep-set (so any stray
-- 'prop:%:troublemaker' award is reaped on the next run) and in the INSERT
-- (so none is ever minted), mirroring how 0014's reconcile predicates pair.
-- The troublemaker prop stays exclusively owned by score_troublemaker().
--
-- **0028 now owns score_tournament()** (supersedes 0020 — base future
-- redefinitions on this version). Function body only: no schema change → no
-- `npm run db:types`; no point value changes → points-sync with
-- lib/scoring/rules.ts holds.

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
  -- prop_key = 'troublemaker' is excluded (0028): that prediction is paid by
  -- score_troublemaker() under its own key; a 'troublemaker' resolution row
  -- must never ALSO mint a generic 10-pt prop award for the same pick.
  delete from point_awards pa
  where pa.prediction_type = 'prop'
    and pa.idempotency_key like 'prop:%'
    and not exists (
      select 1
      from player_prop_predictions ppp
      join player_prop_resolutions ppr on ppr.prop_key = ppp.prop_key
      where pa.idempotency_key = 'prop:' || ppp.user_id::text || ':' || ppp.prop_key
        and ppp.player_id = ppr.player_id
        and ppp.prop_key <> 'troublemaker'
    );
  insert into point_awards (user_id, prediction_type, prediction_ref, points, idempotency_key)
  select ppp.user_id, 'prop', ppp.id, points_player_prop(),
         'prop:' || ppp.user_id::text || ':' || ppp.prop_key
  from player_prop_predictions ppp
  join player_prop_resolutions ppr on ppr.prop_key = ppp.prop_key
  where ppp.player_id = ppr.player_id
    and ppp.prop_key <> 'troublemaker'
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
