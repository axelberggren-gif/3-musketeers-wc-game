-- 0026_reveal_group_picks_at_round1_lock.sql
--
-- Reveal group-stage 1X2 picks to league-mates once round 1 locks (first kickoff),
-- matching how tournament_predictions / player_prop_predictions already reveal
-- (`tp_read_after_lock` / `pp_read_after_lock` in 0001_init.sql use `round1_locked()`).
--
-- Why: every round-1 pick is immutable after `first_kickoff_at` (the lock trigger +
-- `round1_locked()` enforce this), so revealing the whole group-stage slate at once
-- leaks no editable information — it's identical in spirit to the props already doing
-- so. The old per-match `mp_read_after_kickoff` (0001_init.sql) revealed each pick only
-- when that specific match kicked off, so a friend's matchday-10 pick stayed hidden
-- until matchday 10 even though it was locked on matchday 1. This powers the
-- Pick-personality cohort (you-vs-league bars + boldness) and the profile "Recent
-- picks" list from group-stage start, rather than trickling in match by match.
--
-- Scope note: `/match/[id]` is unaffected — that page self-gates its friends-picks
-- fetch on `matchIsLocked(match.kickoff_at)` before RLS is consulted. `mp_read_self`
-- and `mp_write_self` are untouched. `bracket_predictions` reveal stays per-slot.
--
-- Append-only: supersedes the policy from 0001_init.sql without editing it. Idempotent
-- (drops both the old and new policy names before creating). RLS-only — no schema
-- change, so no `npm run db:types`; no point values touched.

drop policy if exists "mp_read_after_kickoff" on match_predictions;
drop policy if exists "mp_read_after_lock" on match_predictions;
create policy "mp_read_after_lock" on match_predictions
  for select to authenticated using (
    round1_locked() and exists (
      select 1 from league_members lm_self
      join league_members lm_other on lm_other.league_id = lm_self.league_id
      where lm_self.user_id = auth.uid() and lm_other.user_id = match_predictions.user_id
    )
  );
