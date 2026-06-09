-- 0025_relax_total_goals_cap.sql
-- Remove the upper bound on tournament_predictions.total_goals_guess.
--
-- The "Total goals" outright prop (whole-tournament goal count, added in
-- migration 0005) capped guesses at 0..300 via an inline column CHECK. But
-- WC 2026 has 104 matches, so even a moderately high-scoring tournament
-- (~3 goals/match) clears 300 — the cap was a binding limit on a legitimate
-- guess. We drop the upper bound and keep only the non-negative floor (you
-- can't score negative goals).
--
-- Scoring is closest-guess (score_total_goals_guess from 0005/0014), so an
-- unbounded guess can never inflate points — a wild number just loses. No
-- point value changes, so the points-sync invariant with rules.ts is untouched.
--
-- Append-only: 0005 is left intact. The inline CHECK it created is auto-named
-- `tournament_predictions_total_goals_guess_check` (standard PostgreSQL
-- <table>_<column>_check naming; it's the only CHECK on the column). We drop it
-- and re-add a >= 0 constraint under the same name — drop-then-add keeps this
-- idempotent on re-apply. The column type is unchanged → no `npm run db:types`.
--
-- Mirrored in lib/predictions/actions.ts (setTotalGoalsGuess drops its > 300
-- branch) and components/predict/NumberInput.tsx (`max` is now optional).

alter table tournament_predictions
  drop constraint if exists tournament_predictions_total_goals_guess_check;

alter table tournament_predictions
  add constraint tournament_predictions_total_goals_guess_check
  check (total_goals_guess is null or total_goals_guess >= 0);
