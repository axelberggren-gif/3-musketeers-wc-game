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

## Conventions
- All point values are exported as a `const` object — never inline a magic number
  elsewhere; always import from `POINTS`.
- Lock helpers take an optional `now = new Date()` so tests/components can pass a
  fixed time. Don't read `Date.now()` inside business logic; pass it in.

## Invariants (do not break)
- **Points sync** (critical): every numeric value in `POINTS` has a mirrored SQL
  function in `supabase/migrations/0002_scoring.sql` (`points_match_1x2`,
  `points_bracket_slot`, `points_tournament_winner`, `points_tournament_runner_up`,
  `points_top_scorer`, `points_dark_horse`, `points_player_prop`). **If you change a
  value here, you MUST add a new migration that updates the matching SQL function.**
  Never edit `0002_scoring.sql` directly — migrations are append-only.
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
- 2026-05-19: Added vitest unit tests (`rules.test.ts`, `lock.test.ts`) so a points-sync drift between `rules.ts` and SQL surfaces in CI.
