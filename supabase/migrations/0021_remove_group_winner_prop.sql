-- World Cup 2026 Bet Game — retire the group-winner prop entirely.
--
-- Why
-- ---
-- The 12 "pick each group's winner" predictions (5 pts each) were dropped from the
-- product: a group's winner is already implied by the group-stage 1X2 picks, so the
-- separate picker was redundant and confusing. This migration removes the whole
-- group-winner scoring + storage stack. (The picker — relocated into the Outcomes tab
-- in #103 — its server action, and the data fetch are removed in the same PR;
-- `POINTS.tournament.groupWinner` is dropped from `lib/scoring/rules.ts`, keeping the
-- points-sync invariant intact.)
--
-- What
-- ----
-- 1. settle_group_stage_props() no longer scores group winners — it only drives
--    score_first_eliminated() now (the surviving group-stage prop, owned by 0017).
-- 2. Drop score_group_winner() and the points_group_winner() constant function.
-- 3. Reap any awards the now-dead scorer wrote (idempotency_key prefix
--    `tournament:group_winner:`). Pre-tournament there are none; the DELETE keeps
--    this correct if a group had already settled. Standings self-heal on the next
--    syncFixtures() run (refresh_league_standings), mirroring how 0014 corrections heal.
-- 4. Drop the now-unused tables group_winner_predictions + group_settlements
--    (CASCADE clears their RLS policies, indexes, and lock trigger).
--
-- Append-only: 0005 / 0019 are untouched. The function bodies in 0005/0019 that
-- referenced these objects are superseded by the create-or-replace + drops below;
-- PL/pgSQL bodies create no tracked dependencies, so the drops are safe.

-- 1. Driver: only first-eliminated remains as a group-stage prop.
create or replace function settle_group_stage_props()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform score_first_eliminated();
end;
$$;

-- 2. Drop the scorer and its point-constant function.
drop function if exists score_group_winner(char);
drop function if exists points_group_winner();

-- 3. Reap any group-winner awards already handed out (none pre-tournament).
delete from point_awards where idempotency_key like 'tournament:group_winner:%';

-- 4. Drop the storage tables (CASCADE removes RLS policies, indexes, lock trigger).
drop table if exists group_winner_predictions cascade;
drop table if exists group_settlements cascade;
