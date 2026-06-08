-- World Cup 2026 Bet Game — reconcile the group-winner prop on result corrections.
--
-- Problem
-- -------
-- 0014_reconcile_scoring.sql converted score_match / score_bracket / score_tournament
-- (and its tournament-wide sub-scorers) from insert-only to reconcile
-- (delete-stale-then-insert), so a corrected/overridden result revokes the now-wrong
-- award. It explicitly left the two GROUP-STAGE props out of scope:
--   * score_group_winner(group)  — early-returns if group_settlements has the group.
--   * score_first_eliminated()   — early-returns if first_elimination.team_id is set.
-- Those bookkeeping rows are write-once "already done" latches. Once written the scorer
-- short-circuits, so a later correction to a group's matches (admin override, or a
-- football-data revision) can never move the 5-pt group-winner award to the now-correct
-- team — the same "inflated standings after a correction" class 0014 set out to
-- eliminate. (See the 0014 entry in supabase/migrations/CLAUDE.md.)
--
-- score_first_eliminated() has the same one-shot problem, but it is rewritten and brought
-- under the reconcile model in 0017_fix_first_eliminated_48team.sql (which also fixes the
-- 48-team detection gap, #81). To avoid two migrations clobbering each other's
-- create-or-replace of that function, THIS migration owns only score_group_winner() and
-- the settle_group_stage_props() driver; 0017 owns score_first_eliminated().
--
-- Fix
-- ---
-- Bring score_group_winner() under 0014's reconcile model:
--   1. Drop the early-return on the group_settlements latch.
--   2. Re-derive the latch from the CURRENT result every run, via on-conflict-do-update
--      gated on `is distinct from` so an unchanged result is a no-op.
--   3. DELETE the awards it owns whose underlying prediction no longer matches the current
--      winner (stale-only predicate), then re-INSERT with `on conflict do nothing`.
--   4. If the group is no longer fully decided (a FINISHED match reverted), delete every
--      award we own for the group and clear the latch.
-- The delete is stale-only: on an unchanged result it removes zero rows and the insert is
-- a no-op, so the function stays idempotent under the 10-min cron (mirrors 0014).
--
-- settle_group_stage_props() drops its `not exists (group_settlements ...)` filter and now
-- calls score_group_winner(g) for every group every run — safe given the idempotency above.
-- It still calls score_first_eliminated() each run (defined in 0005, rewritten by 0017).
--
-- Point value UNCHANGED (points_group_winner() = 5), so the points-sync invariant with
-- lib/scoring/rules.ts holds. Append-only: this file create-or-replaces the functions;
-- 0005/0014 are untouched.

-- ---------------------------------------------------------------------------
-- score_group_winner(group) — reconcile the 5-pt group-winner award.
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
  select count(*) into v_remaining
    from matches
    where group_letter = p_group and stage = 'GROUP' and status <> 'FINISHED';

  -- Group no longer fully decided (e.g. a FINISHED match was reverted to SCHEDULED):
  -- drop every group-winner award we handed out for this group and un-settle it.
  if v_remaining > 0 then
    delete from point_awards
    where idempotency_key like 'tournament:group_winner:' || p_group || ':%';
    delete from group_settlements where group_letter = p_group;
    return 0;
  end if;

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

  -- No standings at all (no finished matches with teams): nothing to settle.
  if v_winner_team_id is null then
    delete from point_awards
    where idempotency_key like 'tournament:group_winner:' || p_group || ':%';
    delete from group_settlements where group_letter = p_group;
    return 0;
  end if;

  -- Re-derive the latch from the current result (move it if the winner flipped).
  insert into group_settlements (group_letter, winner_team_id, settled_at)
  values (p_group, v_winner_team_id, now())
  on conflict (group_letter) do update
    set winner_team_id = excluded.winner_team_id, settled_at = excluded.settled_at
    where group_settlements.winner_team_id is distinct from excluded.winner_team_id;

  -- Drop awards whose owning prediction no longer picks the current winner.
  delete from point_awards pa
  where pa.idempotency_key like 'tournament:group_winner:' || p_group || ':%'
    and not exists (
      select 1 from group_winner_predictions gwp
      where gwp.group_letter = p_group
        and gwp.team_id = v_winner_team_id
        and pa.idempotency_key =
            'tournament:group_winner:' || p_group || ':' || gwp.user_id::text
    );

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
-- settle_group_stage_props() — driver called from syncFixtures after every match
-- upsert. Now calls score_group_winner(g) for EVERY group each run (the scorers are
-- idempotent on unchanged results) so corrections re-settle without a manual nudge.
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
  loop
    perform score_group_winner(g);
  end loop;
end;
$$;
