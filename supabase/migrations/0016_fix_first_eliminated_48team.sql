-- ===========================================================================
-- 0016_fix_first_eliminated_48team.sql
--
-- Fix: score_first_eliminated() must not settle the "first eliminated" prop on
-- a team that can still advance under WC 2026's 48-team format.
--
-- The original implementation (0005_more_tournament_props.sql) flagged a team
-- the moment it could no longer finish in its GROUP's top 2. That was correct
-- for the old 32-team format (8 groups, top-2 advance) but is WRONG for WC 2026:
-- 12 groups of 4, where the 8 best third-placed teams ALSO advance. Being out of
-- the group top-2 is therefore NOT the same as being eliminated from the
-- tournament, so the 10-pt prop could settle on the wrong team, at the wrong
-- time, and — because settlement is one-shot (gated by the first_elimination
-- row) and 0014's reconcile rewrite deliberately skips group-stage settlements —
-- never self-correct.
--
-- This migration replaces the function body only (no schema change, no point
-- value change, so the points-sync invariant with lib/scoring/rules.ts holds).
-- Migrations are append-only: 0005 is left untouched.
--
-- ---------------------------------------------------------------------------
-- New definition (sound / conservative — never settles wrong, may settle late):
--
-- A team X is flagged only when it is mathematically out of BOTH the group
-- top-2 AND the best-8-thirds race, using strict point inequalities so ties
-- never count as "guaranteed ahead" (the safe direction for an elimination).
--
--   max_pts(X)        = X.pts + 3 * remaining group games        (X's ceiling)
--   rivals_above(X)   = # same-group rivals with current pts > max_pts(X)
--                       (a rival's current pts is a guaranteed floor on its
--                        final total — points only ever increase — so each such
--                        rival is guaranteed to finish above X)
--   third_floor(G)    = the 3rd-largest current pts among group G's 4 teams.
--                       Because final points dominate current points
--                       component-wise, the 3rd order-statistic also dominates:
--                       G's eventual 3rd-place team is guaranteed >= third_floor(G).
--   groups_3rd_above  = # OTHER groups G with third_floor(G) > max_pts(X)
--                       (each such group is guaranteed to send a 3rd-placed team
--                        that outranks X in the thirds pool)
--
-- X is eliminated  <=>  rivals_above(X) >= 3
--                       OR ( rivals_above(X) >= 2 AND groups_3rd_above >= 8 )
--
--   - rivals_above >= 3  => X is 4th-or-worse in its group => can't even be its
--     group's 3rd => out.
--   - rivals_above >= 2  => X can't be top-2; with >= 8 other groups guaranteed
--     to outrank it in the thirds race, X can't be a best-8 third either => out.
--
-- Elimination under this rule is monotone (X's ceiling is fixed; everyone else
-- only gains points), so the one-shot first_elimination row stays correct
-- forever — which is exactly why the 0014 non-reconcile limitation doesn't bite
-- this scorer.
-- ===========================================================================

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
  -- 3rd-largest current pts per group (positional order statistic; null if the
  -- group has fewer than 3 teams loaded — such a group never counts as "above").
  group_third_floor as (
    select group_letter, pts as third_floor
    from (
      select group_letter, pts,
             row_number() over (partition by group_letter order by pts desc) as rn
      from per_team_max
    ) ranked
    where rn = 3
  ),
  with_counts as (
    select pmx.team_id, pmx.group_letter, pmx.max_pts, pmx.last_finished_at,
      (
        select count(*) from per_team_max o
        where o.group_letter = pmx.group_letter
          and o.team_id <> pmx.team_id
          and o.pts > pmx.max_pts
      ) as rivals_above,
      (
        select count(*) from group_third_floor gtf
        where gtf.group_letter <> pmx.group_letter
          and gtf.third_floor > pmx.max_pts
      ) as groups_third_above
    from per_team_max pmx
  ),
  candidates as (
    select team_id, group_letter, last_finished_at
    from with_counts
    where rivals_above >= 3
       or (rivals_above >= 2 and groups_third_above >= 8)
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
