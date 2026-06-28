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
- `bracket-tree.ts` — `BRACKET_UPSTREAM` map encoding which slots feed each
  knockout slot (R32 pairs → R16-N, R16 pairs → QF-X, etc.); `R32_QUALIFIERS`,
  the official WC 2026 R32 matchup map (R32-1..16 = Matches 73–88, each side a
  `QualSource`: Winner/Runner-up of a group, or 3rd of one of five candidate
  groups) with `qualSourceLabel()` for placeholder text; `slotFriendlyName()`
  (slot → "Quarter-final 1" / "Round of 16 #3" / "Final"); `computeGroupFinals()`
  which derives each group's winner/runner-up from real football-data results
  once that group is fully played (points → GD → GF → team id). Also the legacy
  `predictedGroupStandings()` / `suggestR32Qualifiers()` / `filterSuggestionsByMatchPairs()`
  (now unused by the UI — kept for tests/back-compat). Pure functions, no IO.
- `first-eliminated.ts` — `isEliminatedFromTournament(team, all)` /
  `firstEliminatedTeamId(all)` + `maxReachablePoints()` and `BEST_THIRDS_ADVANCING`.
  Pure mirror of the SQL `score_first_eliminated()` (migration
  `0017_fix_first_eliminated_48team.sql`): a team is "first eliminated" only when
  out of BOTH its group's top 2 AND the best-8-thirds race (WC 2026 advances the 8
  best third-placed teams). Pure functions, no IO.

## Conventions
- All point values are exported as a `const` object — never inline a magic number
  elsewhere; always import from `POINTS`.
- Lock helpers take an optional `now = new Date()` so tests/components can pass a
  fixed time. Don't read `Date.now()` inside business logic; pass it in.

## Invariants (do not break)
- **Points sync** (critical): every numeric value in `POINTS` has a mirrored SQL
  function across `supabase/migrations/0002_scoring.sql`,
  `supabase/migrations/0005_more_tournament_props.sql`,
  `supabase/migrations/0020_more_outright_props.sql` and
  `supabase/migrations/0022_manual_admin_props.sql` and
  `supabase/migrations/0023_league_internal_bets.sql` (`points_match_1x2`,
  `points_bracket_slot`, `points_tournament_winner`, `points_tournament_runner_up`,
  `points_top_scorer`, `points_player_prop`, `points_total_goals_base`,
  `points_highest_match_base`, `points_troublemaker`,
  `points_first_eliminated`, `points_final_goals_base`,
  `points_biggest_win_margin_base`, `points_golden_boot_goals_base`,
  `points_total_red_cards_base`, `points_manual_prop`, `points_league_loser_guess`,
  `points_league_loser_per_vote`, `points_league_crown_penalty_per_vote`).
  **If you change a value here, you MUST add a new
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
- **Top scorer + troublemaker are drain-gated** (migration 0016, #83): they read
  `player_goal_log` / `player_card_log`, which `syncFixtures()` populates 5 matches at
  a time, so `score_tournament()`'s top-scorer block and all of `score_troublemaker()`
  short-circuit until `all_match_details_synced()` is true (no FINISHED match with
  `details_synced_at IS NULL`). Prevents the wrong winner showing in the window right
  after the Final; self-heals once the per-match detail drain catches up.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-06-27: `computeGroupFinals()` is **no longer used by the bracket UI** (it stays here, pure + tested, for back-compat). It was feeding `BracketBuilder`'s R32 entry cells a guessed winner/runner-up per the `R32_QUALIFIERS` map, but that map's slot numbering follows FIFA's "Matches 73–88" order while `deriveBracketSlot()` slots by **kickoff order** — the two don't line up, so the guess placed a team in the wrong R32 slot and duplicated one already placed by the authoritative imported fixture (the NED/MAR-in-two-slots bug). The bracket now resolves R32 sides only from the imported fixture (`slotMatches`, read per-side). `computeGroupFinals()` also has no head-to-head tiebreak, so its ordering could disagree with football-data outright — another reason it's unsafe as a live source. `R32_QUALIFIERS` / `qualSourceLabel()` are still used for the *placeholder labels* on unresolved sides.
- 2026-06-08: Added `POINTS.leagueBet` (`loserGuess` 5, `loserPerVote` 2, `crownPenaltyPerVote` 5) for the internal league bets, mirrored by `points_league_loser_guess()` / `points_league_loser_per_vote()` / `points_league_crown_penalty_per_vote()` in migration `0023_league_internal_bets.sql` (added to the points-sync invariant list above + asserted in `rules.test.ts`). These are **league-scoped** awards (`point_awards.league_id`), unlike every other `POINTS.*` value, and the crown penalty is applied as a negative award. Scored by the new reconcile scorer `score_league_group_bets()` (in 0023), driven from `settle_group_stage_props()` once the group stage is FINISHED — not called from TS.
- 2026-06-08: `bracket-tree.ts` gained the R32 group-qualification layer for the bracket UI: `R32_QUALIFIERS` (official WC 2026 Matches 73–88 mapped to slots R32-1..16, **in kickoff/schedule order** to line up with `syncFixtures()`/`deriveBracketSlot()`'s kickoff-order slotting), `QualSource` (`winner`/`runnerup`/`third` of a group), `qualSourceLabel()`, `slotFriendlyName()` (used by `BracketBuilder`'s "Winner of Quarter-final 1" feeder labels), and `computeGroupFinals(matches)` which resolves each group's winner/runner-up from real football-data scores **only once every match in that group is FINISHED** (sort: points → GD → GF → team id; no head-to-head tiebreak — the imported real R32 fixture is authoritative and overrides this). Third-place R32 sides are never resolved here (FIFA's Annex C matrix isn't reproduced) — they fill from the imported fixture. Pure, no IO; tests in `bracket-tree.test.ts`. No point values touched, so points-sync holds.
- 2026-06-08: Added `POINTS.manualProp` (5), mirrored by `points_manual_prop()` in migration `0022_manual_admin_props.sql` (added to the points-sync invariant list + asserted in `rules.test.ts`). It's the flat value for seven admin-resolved "house special" props (Neymar minutes / streaker / best goalkeeper / golden-boot team / own-goals count / war-game match / Swedish-players count). Five are exact-match (full 5 pts to every correct picker); the two numeric ones (own goals, Swedish players) are closest-guess with ties splitting the base, like total-goals. Scoring is a standalone `score_manual_props()` driver (seven reconciling sub-scorers) that the admin "save results" action calls directly — **not** chained into `score_tournament()`, so these settle whenever the commissioner resolves them rather than waiting for the Final.
- 2026-06-08: Removed the group-winner prop. `POINTS.tournament.groupWinner` (5 pts) deleted from `rules.ts` (+ its `rules.test.ts` assertion); migration `0021_remove_group_winner_prop.sql` drops `score_group_winner()` / `points_group_winner()`, rewrites `settle_group_stage_props()` to only drive `score_first_eliminated()`, reaps any `tournament:group_winner:%` awards, and drops the `group_winner_predictions` + `group_settlements` tables. The pick was redundant with the group-stage 1X2 picks. Points-sync list above no longer includes `points_group_winner`.
- 2026-06-08: `POINTS.tournament` gained four over-under bases — `finalGoalsBase` (10), `biggestWinMarginBase` (10), `goldenBootGoalsBase` (10), `totalRedCardsBase` (15) — mirrored by `points_final_goals_base()` / `points_biggest_win_margin_base()` / `points_golden_boot_goals_base()` / `points_total_red_cards_base()` in migration `0020_more_outright_props.sql` (added to the points-sync invariant list + asserted in `rules.test.ts`). Each is a closest-guess prop scored exactly like total-goals (reconcile + ties-split); golden-boot tally + total red cards are **drain-gated** (`all_match_details_synced()`) like top-scorer/troublemaker since they read `player_goal_log` / `player_card_log`. `score_tournament()` was re-created from its 0016 body with the four new sub-scorers appended (the live owner of `score_tournament` is now 0020). No new `score_*` is called from TS — they run inside `score_tournament()`, already invoked by `syncFixtures()` once the Final is FINISHED.
- 2026-06-05: New `first-eliminated.ts` (+ `first-eliminated.test.ts`) — pure mirror of the SQL `score_first_eliminated()`, rewritten in migration `0017_fix_first_eliminated_48team.sql` to fix the WC 2026 48-team gap (#81): "out of group top-2" is not elimination because the 8 best third-placed teams also advance. `isEliminatedFromTournament(team, all)` flags a team only when out of BOTH group top-2 AND the best-8-thirds race (`rivals_above >= 3`, or `>= 2` plus `>= 8` other groups whose 3rd-place points floor exceeds the team's ceiling); `firstEliminatedTeamId(all)` picks the earliest-clinched one. Sound/conservative, strict point bounds, no GD/GF tiebreaks. This module is the canonical spec the SQL mirrors — keep them in sync (same philosophy as the points-sync invariant), point value unchanged at 10.
- 2026-05-27: `filterSuggestionsByMatchPairs(suggestions, slotMatches)` added to `bracket-tree.ts`. Drops a `Qualifier` whose `teamId` isn't one of the two team IDs in `slotMatches[slot]` (when the slot has a real match imported from football-data). Lets the bracket "Suggest qualifiers" button stay accurate after the draw — pre-import the map is empty and every suggestion passes through; post-import we only suggest a team if it's actually playing in that R32 match. Tests cover empty-map passthrough, match+team match, mismatch dropped, and slot-without-match passthrough. New `BracketSlotMatchPair` type exported alongside.
- 2026-05-27: `suggestR32Qualifiers` capped at 16 picks (one per R32 match slot — `R32-1..R32-16`). Previous version generated up to 32 picks (top-2 per group + best-8 third-place into `R32-25..R32-32`), which produced ghost suggestions for slots that don't exist in `buildSlotDefs()` — `setBracketPicksBulk` would have written orphan `bracket_predictions` rows that no match-import path can ever resolve. New rule: collect group winners + runners-up across all 12 groups (24 candidates), sort by predicted points (alphabetical name tiebreaker), take top 16, place in `R32-1..R32-16` in that order. Third-place teams no longer factor in — each R32 slot represents the **winner** of an R32 match, not a team position. New `R32_SLOT_COUNT = 16` constant pinned in the helper.
- 2026-05-27: New `bracket-tree.ts` encodes the knockout slot graph (`BRACKET_UPSTREAM`: R32 pairs feed R16-N; R16 pairs feed QF-X; QF pairs feed SF-X; SF pair feeds F; F feeds W). Adds `predictedGroupStandings(matches, picksByMatchId)` (3/1/0 point tally from user 1X2 picks, ignores matches missing group letter or teams or pick) and `suggestR32Qualifiers(standings, teamNameById)` (now: top 16 advancers across all groups by predicted points). Pure functions, no IO. Powers progressive reveal + "Suggest qualifiers" button on `/predict/bracket`.
- 2026-05-26: Added `POINTS.bracket.R32 = 1` for the new WC 2026 Round of 32 (first knockout round, less prestigious than R16 = 2). Mirrored in `supabase/migrations/0013_add_r32_stage.sql` (`points_bracket_slot` now matches `R32-%` → 1). `BRACKET_STAGE_BY_SLOT_PREFIX` gets an `R32: "R32"` entry so `bracketPointsForSlot("R32-1")` returns 1. UI and auto-advancement land in follow-up PRs; this PR is the schema/scoring foundation only.
- 2026-05-22: Added `fifa-rankings.ts` (canonical TS source for the 48 WC 2026 ranks) + test. `POINTS.tournament.darkHorse` removed in favour of rank-based scoring (teams.fifa_ranking). New `POINTS.tournament.{totalGoalsBase, highestMatchBase, troublemaker, groupWinner, firstEliminated}` mirror their SQL twins in migration 0005.
- 2026-05-19: Added vitest unit tests (`rules.test.ts`, `lock.test.ts`) so a points-sync drift between `rules.ts` and SQL surfaces in CI.
