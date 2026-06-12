> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# lib/stats/ — profile stats aggregation

## Purpose
Server-side read aggregators that feed the `/profile/[username]` stat cards. Pure DB reads
(no writes, no scoring) via the RLS-aware `supabaseServer()` client. The presentation lives
in `components/stats/`.

## Key files
- `profile.ts` — `loadProfileStats(userId, viewerId)`: points totals by `prediction_type`,
  picks made / correct / accuracy, points-by-day. `picksMade`/`accuracy` are computed
  **only for the profile owner** (`isSelf`) because mixing `point_awards` (public) with
  `match_predictions` (RLS-scoped) for other viewers yields a misleading percentage.
- `personality.ts` — `loadPickPersonality(userId, viewerId)` (+ pure helpers): the **Pick
  personality** view (`DESIGN_MISALIGNMENTS.md` §4). Pick-mix H/D/A, three you-vs-league
  comparison bars (Group/Knockout accuracy, Bracket survival), and Boldness % / Avg pick
  time / Upsets called. Returns `null` when no content is visible to the viewer.
- `personality.test.ts` — vitest unit tests for the pure helpers (the math runs without a DB).
- `group-picks.ts` — `loadGroupStagePicks(userIds)`: every GROUP match + each given
  user's 1X2 pick per match (RLS-scoped), feeding the profile "Group-stage picks"
  board and `/compare`. Pure helpers `pickOutcome()` (correct/wrong/pending),
  `tallyPickRecord()` (made/decided/correct), `groupMatchesByLetter()`.
- `group-picks.test.ts` — vitest unit tests for those pure helpers.

## Conventions
- Use `supabaseServer()` (RLS-aware, acts as the viewer) — **never** `supabaseService()`.
  RLS is the access gate; let it scope rows. Aggregate in TS (these are small, friends-league
  datasets), mirroring `profile.ts`.
- Factor the math into **pure exported functions** that take plain arrays/Maps, so it's
  unit-testable without Supabase. The loader does only IO + a single `computePersonality(...)` call.
- Return **plain serialisable objects** (numbers / nullable numbers / small records). Keep
  internal `Map`s internal — they must not cross the RSC → component boundary.
- Every sub-stat is **nullable** and div-by-zero-guarded → `null`, never `NaN`. The UI degrades.

## Invariants (do not break)
- **No service-role, no writes, no scoring.** Reads only. Point values live in
  `lib/scoring/rules.ts`; nothing here mints `point_awards`.
- **`personality.ts` reveal assumption**: the cohort (you-vs-league + boldness) depends on
  league-mates' group picks being readable, which migration
  `0026_reveal_group_picks_at_round1_lock.sql` grants at round-1 lock. Accuracy bars also need
  FINISHED matches (already past kickoff → already revealed), so they're never blocked by
  reveal timing. If you tighten that RLS again, the cohort silently empties.
- Comparison "league average" = **mean of each member's own fraction** (equal-weight per
  member, the "average player"), and is suppressed unless ≥2 members contributed.

## Known gotchas
- Tunable constants live at the top of `personality.ts`: `BOLDNESS_MAX_SHARE = 0.25`,
  `UPSET_RANK_MARGIN = 5`, `KNOCKOUT_LADDER`. Bracket survival = champion (`W`) pick's
  rounds-won / ladder length (1.0 = won the Final; `null` if the champ never played a
  finished KO match).
- `match_predictions.submitted_at` is the **first**-pick time (not bumped on edit), so "Avg
  pick time" measures how early you first locked a match, not your last edit.
- `match_predictions` are group-stage only in practice; knockout accuracy + bracket survival
  read `bracket_predictions` (per-slot RLS reveal, unchanged by 0026) joined to `matches`.
- `teams.fifa_ranking`: lower = stronger. Upsets need both sides ranked; absent ranks degrade
  the stat to `null`.

## Recent changes
- 2026-06-12: Added `group-picks.ts` + `group-picks.test.ts` — RLS-aware loader for the
  full group-stage picks board (profile page) and the `/compare` head-to-head, with
  pure tested helpers (`pickOutcome` / `tallyPickRecord` / `groupMatchesByLetter`).
  Multi-user (`userIds[]`) so one fetch serves both compare slots. Same reveal
  assumption as `personality.ts` (migration 0026: league-mates see group picks once
  round 1 locks); a FINISHED match with `winner = null` counts as pending, not decided.
- 2026-06-09: Added `personality.ts` + `personality.test.ts` for `DESIGN_MISALIGNMENTS.md`
  §4 (Pick personality). RLS-aware cohort, pure tested helpers, `null`-when-empty contract.
  Rendered by `components/stats/PickPersonality.tsx`; cohort visibility from group-stage
  start via migration `0026_reveal_group_picks_at_round1_lock.sql`.
