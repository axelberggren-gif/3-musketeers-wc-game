-- 0018_scoring_hygiene.sql
-- Scoring SQL hygiene cleanup (no change to any awarded point value).
--
-- 1. Drop dead `points_dark_horse()`. It returned a flat 10 and was only ever
--    referenced by the superseded `score_tournament()` bodies in 0002 and 0004.
--    Dark-horse scoring became rank-based in 0005 and the live `score_tournament()`
--    (0014) pays `teams.fifa_ranking`, so the function has no live caller. PL/pgSQL
--    bodies don't create tracked function-to-function dependencies, and the only
--    references live in already-replaced function bodies, so the drop is safe.
--
-- 2. Stop `score_bracket()` from minting a 0-point `bracket` award for a stray
--    `bracket_slot = '3RD'` prediction. The 3rd-place playoff has a real match row
--    and `score_bracket()` joins any slot, but `points_bracket_slot('3RD')` falls
--    through to `else 0`. The bracket UI never offers a `3RD` slot, so such a row is
--    only reachable via direct DB writes — this is defence-in-depth, not a live bug.
--    Totals are unaffected (it added 0); we just stop emitting the noise row and
--    clean up any that already exist (the DELETE excludes '3RD' from the keep-set).

-- ---------------------------------------------------------------------------
-- 1. Drop dead points_dark_horse().
-- ---------------------------------------------------------------------------

drop function if exists points_dark_horse();

-- ---------------------------------------------------------------------------
-- 2. score_bracket() — identical to 0014 except it ignores the '3RD' slot.
--    Reconcile (delete-stale-then-insert), same as 0014. The keep-set in the
--    DELETE and both INSERTs now exclude '3RD', so a pre-existing 0-point '3RD'
--    award is reaped on the next run and no new one is ever written.
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
  -- flipped, so the predicted team no longer advanced), whose pick is gone, or
  -- whose slot is '3RD' (a non-offered slot that only scores 0).
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
        and bp.bracket_slot <> '3RD'
        and m.status = 'FINISHED'
        and m.winner is not null
        and (
          (m.winner = 'HOME' and m.home_team_id = bp.team_id)
          or (m.winner = 'AWAY' and m.away_team_id = bp.team_id)
        )
    );

  -- Per-slot stages: R32, R16, QF, SF, F. '3RD' is excluded — it scores 0 and is
  -- never offered by the UI.
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
  where bp.bracket_slot <> '3RD'
    and m.status = 'FINISHED'
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
