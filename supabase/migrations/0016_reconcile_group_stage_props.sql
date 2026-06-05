-- World Cup 2026 Bet Game — reconcile the two group-stage props on result corrections.
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
-- football-data revision) can never move the 5-pt group-winner or 10-pt first-eliminated
-- award to the now-correct team — the same "inflated standings after a correction" class
-- 0014 set out to eliminate. (See the 0014 entry in supabase/migrations/CLAUDE.md.)
--
-- Fix
-- ---
-- Bring both scorers under 0014's reconcile model:
--   1. Drop the early-return on the latch.
--   2. Re-derive the latch (group_settlements / first_elimination) from the CURRENT
--      result every run, via on-conflict-do-update gated on `is distinct from` so an
--      unchanged result is a no-op.
--   3. DELETE the awards each function owns whose underlying prediction no longer matches
--      the current winner / eliminated team (stale-only predicate), then re-INSERT the
--      correct set with `on conflict (idempotency_key) do nothing`.
--   4. If the result is no longer decided (a FINISHED match reverted, so the group is
--      incomplete or there's no candidate), delete every award we own and clear the latch.
-- The delete is stale-only: on an unchanged result it removes zero rows and the insert is
-- a no-op, so the functions stay idempotent under the 10-min cron (mirrors 0014).
--
-- settle_group_stage_props() drops its `not exists (group_settlements ...)` filter and now
-- calls score_group_winner(g) for every group every run — safe given the idempotency above.
--
-- Point values are UNCHANGED (points_group_winner() = 5, points_first_eliminated() = 10),
-- so the points-sync invariant with lib/scoring/rules.ts holds. Append-only: this file
-- create-or-replaces the functions; 0005/0014 are untouched.
--
-- Note: removing first_elimination's write-once guard means score_first_eliminated() now
-- always reflects the first-eliminated team for the CURRENT set of FINISHED results, which
-- also lets a revised approximation self-correct (partially helps #81). The selection
-- algorithm itself is unchanged — #81's approximation gap remains its own concern.

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
-- score_first_eliminated() — reconcile the 10-pt first-eliminated award.
-- Selection unchanged (see 0005 header for the max-possible-points heuristic and
-- its documented approximation); only the one-shot latch becomes re-derivable.
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

  -- No team eliminated under the current results (e.g. a correction un-eliminated the
  -- prior team): drop every first-eliminated award and clear the latch.
  if v_team_id is null then
    delete from point_awards where idempotency_key like 'tournament:first_elim:%';
    update first_elimination set team_id = null, detected_at = null where id = 1;
    return 0;
  end if;

  -- Re-derive the singleton latch from the current result (move it if it flipped).
  insert into first_elimination (id, team_id, detected_at)
  values (1, v_team_id, now())
  on conflict (id) do update
    set team_id = excluded.team_id, detected_at = excluded.detected_at
    where first_elimination.team_id is distinct from excluded.team_id;

  -- Drop awards whose owning prediction no longer picks the current eliminated team.
  delete from point_awards pa
  where pa.idempotency_key like 'tournament:first_elim:%'
    and not exists (
      select 1 from tournament_predictions tp
      where tp.first_eliminated_team_id = v_team_id
        and pa.idempotency_key = 'tournament:first_elim:' || tp.user_id::text
    );

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
