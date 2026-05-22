> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# lib/scoring/ — points config + match-lock logic

## Purpose
Single source of truth (TS side) for point values awarded by the game, plus pure
functions that decide whether predictions are locked based on tournament dates.
Actual point-awarding writes happen in SQL functions (see `supabase/migrations/0002_scoring.sql`).

## Key files
- `rules.ts` — `POINTS` object with match / bracket / tournament / player-prop values
  and `bracketPointsForSlot(slot)` helper.
- `lock.ts` — `computeLockState(tournament, now)`, `isLocked(kind, ...)`,
  `matchIsLocked(kickoffAt, ...)`. Pure functions, no IO.
- `fifa-rankings.ts` — `FIFA_RANKINGS_2026` constant (TLA → rank 1..48), canonical
  source for the rank-based dark-horse scoring. Seeded into `teams.fifa_ranking`
  by `supabase/migrations/0005_more_tournament_props.sql`.

## Conventions
- All point values are exported as a `const` object — never inline a magic number
  elsewhere; always import from `POINTS`.
- Lock helpers take an optional `now = new Date()` so tests/components can pass a
  fixed time. Don't read `Date.now()` inside business logic; pass it in.

## Invariants (do not break)
- **Points sync** (critical): every numeric value in `POINTS` has a mirrored SQL
  function across `supabase/migrations/0002_scoring.sql` and
  `supabase/migrations/0005_more_tournament_props.sql` (`points_match_1x2`,
  `points_bracket_slot`, `points_tournament_winner`, `points_tournament_runner_up`,
  `points_top_scorer`, `points_player_prop`, `points_total_goals_base`,
  `points_highest_match_base`, `points_troublemaker`, `points_group_winner`,
  `points_first_eliminated`). **If you change a value here, you MUST add a new
  migration that updates the matching SQL function.** Never edit existing
  migration files directly — migrations are append-only.
- **Dark-horse rank sync**: `FIFA_RANKINGS_2026` in `fifa-rankings.ts` is the
  canonical TS source. The seed at the bottom of
  `supabase/migrations/0005_more_tournament_props.sql` mirrors it into
  `teams.fifa_ranking`. When you change ranks, write a new migration with the
  matching UPDATE statements — never edit 0005.
- Lock logic is gated by **two timestamps on the `tournaments` row**:
  `first_kickoff_at` (locks round 1) and `knockout_start_at` (locks round 2). The DB
  also enforces locking via triggers; don't rely on UI-only checks.
- Individual matches lock at their own `kickoff_at` (used by `matchIsLocked`),
  separate from the round-level locks.

## Known gotchas
- `bracketPointsForSlot("F")` and `bracketPointsForSlot("W")` work because the slot
  strings have no `-` separator — the function handles both `STAGE-N` (e.g. `R16-1`)
  and bare `STAGE` (`F`, `W`) by `.split("-")[0]`.
- The DB-side scoring functions live in `supabase/migrations/0002_scoring.sql` and
  use `point_awards.idempotency_key` to dedupe. Never bypass them with raw inserts.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-05-22: Added `fifa-rankings.ts` (canonical TS source for the 48 WC 2026 ranks) + test. `POINTS.tournament.darkHorse` removed in favour of rank-based scoring (teams.fifa_ranking). New `POINTS.tournament.{totalGoalsBase, highestMatchBase, troublemaker, groupWinner, firstEliminated}` mirror their SQL twins in migration 0005.
- 2026-05-19: Added vitest unit tests (`rules.test.ts`, `lock.test.ts`) so a points-sync drift between `rules.ts` and SQL surfaces in CI.
