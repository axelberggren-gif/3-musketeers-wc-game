> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# lib/football-data/ — football-data.org API client + sync

## Purpose
Wrapper around the football-data.org REST API plus the sync functions that pull teams,
players, matches, and scorers into our Supabase tables. Called from the cron handlers
in `app/api/cron/` and from admin actions.

## Key files
- `client.ts` — `FootballDataClient` class (low-level fetch wrapper) + stage/winner/
  status mappers from football-data enums → our DB enums.
- `sync.ts` — `seedTeams()`, `syncFixtures()`, `syncScorers()` server-side functions.
  Use `supabaseService()` (RLS bypass) and log to `external_sync_log`. `syncScorers()`
  is a daily detail-drain + reconcile backstop (NOT a scorers-list fetch — see below).

## Conventions
- All HTTP requests use `cache: "no-store"` — we control freshness via cron cadence,
  not Next caching.
- Every public function in `sync.ts` is wrapped in try/catch and writes a row to
  `external_sync_log` on success and failure. Preserve that pattern when adding new
  syncs — it's the only diagnostic surface visible in the admin UI.
- The football-data API uses external IDs; we always upsert on
  `onConflict: "external_id"` to make repeated runs idempotent.

## Invariants (do not break)
- `FOOTBALL_DATA_TOKEN` env var is required. The client throws if it's missing.
- Sync functions MUST be idempotent. Re-running `syncFixtures()` should produce zero
  side-effects beyond updating mutable fields. Point-awarding is also idempotent via
  the `point_awards.idempotency_key` mechanism in the DB.
- Free-tier rate limit is **10 requests/minute**. Don't add fan-out without thinking
  about this (`syncFixtures` already issues many sub-queries per call).

## Known gotchas
- football-data's `stage` enum doesn't have a direct mapping for our `3RD` (third
  place playoff); see `mapStage()` in `client.ts` if you add new stages.
- `seedTeams()` upserts the team first (returning its local UUID) and then upserts
  players with `team_id` set in the same call — no second pass needed.
- `syncFixtures()` calls SQL RPCs `score_match`, `score_bracket`,
  `score_tournament` (only once the Final is FINISHED),
  `settle_group_stage_props` (per-group + first-eliminated props), and
  `refresh_league_standings` after upserting matches. Those functions live in
  migrations 0002, 0004 and 0005 — keep them in sync.
- `syncFixtures()` derives `bracket_slot` per knockout match by sorting matches
  within each stage by `utcDate` (R32-1..16 / R16-1..8 / QF-A..D / SF-A..B / F).
  Without this, `score_bracket()` would never join.
- `syncFixtures()` also drains up to **5 per-match detail fetches** per run via
  `drainPendingMatchDetails()`: any FINISHED match with `details_synced_at IS NULL`
  is hit on `/matches/{id}` to pick up goals + bookings, then marked. The 5-per-run
  cap keeps total requests under the 10/min budget (list endpoint = 1, details =
  up to 5, leaves a 4-call buffer). Free-tier responses sometimes omit `bookings`;
  the troublemaker prop relies on this and silently scores no one if so — a
  warning is logged to `external_sync_log`.
- **Drain-gated scorers (#83)**: `score_tournament()`'s top-scorer block and the
  whole of `score_troublemaker()` are gated on `all_match_details_synced()`
  (migration 0016) — they short-circuit until NO FINISHED match has
  `details_synced_at IS NULL`. So top scorer / troublemaker never resolve on a
  partial drain backlog right after the Final; they self-heal once the drain
  catches up (`score_tournament()` re-runs every cron while the Final is FINISHED).
- `syncScorers()` (daily 06:00 cron) is the drain backstop, NOT a scorers fetch.
  It calls `drainPendingMatchDetails()` with a higher cap (`SCORERS_DRAIN_LIMIT = 8`)
  — it spends no request on the list endpoint, so its full 10/min budget goes to
  detail fetches — then re-runs `score_tournament()` + `refresh_league_standings`.
  Keep it under 10 req/min and idempotent (the drain upserts; scoring dedupes via
  `idempotency_key`).

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-06-05: `syncScorers()` repurposed from an informational `/scorers` fetch (fed no scoring table) into a daily detail-drain + reconcile backstop: drains up to `SCORERS_DRAIN_LIMIT = 8` pending FINISHED-match details via `drainPendingMatchDetails()`, then re-runs `score_tournament()` + `refresh_league_standings`. Pairs with migration 0016, which gates `score_tournament()`'s top-scorer block and `score_troublemaker()` on `all_match_details_synced()` so those two categories never resolve on a partial drain backlog right after the Final (#83). Return shape changed to `{ detailsSynced, scored }`; `runSyncScorers()` admin action just spreads it. `fd.scorers()` / `FdScorer` are now unused by sync but kept in `client.ts`.
- 2026-05-26: `FdMatch.stage` union gains `"LAST_32"` and `mapStage()` translates it to our new `R32` local stage (added in migration 0013). `deriveBracketSlot()` now mints `R32-1..R32-16` for first-knockout-round matches by kickoff order. `syncFixtures()` already calls `deriveBracketSlot()` generically so it picks up R32 without further edits. If football-data uses a different label than `LAST_32` for actual WC 2026 data, only this mapping needs updating — the DB enum value `R32` is the canonical local stage.
- 2026-05-24: Fixed `group_letter` parser — `m.group` is `"GROUP_A"`..`"GROUP_L"` in v4 (matching the `stage` enum convention), not the legacy `"Group A"` form. The old `replace("Group ", "").slice(0, 1)` was a no-op and returned `"G"` for every group. New `parseGroupLetter()` helper accepts both. `syncFixtures` now calls `backfill_team_group_letters` RPC (migration 0010) after the match upsert loop so `teams.group_letter` (which nothing else wrote) self-heals from match data.
- 2026-05-22: `syncFixtures` drains up to 5 per-match detail fetches per run into `player_goal_log` / new `player_card_log` (gated on `matches.details_synced_at`); calls `settle_group_stage_props` RPC for progressive group-winner / first-eliminated scoring. `FdBooking` interface + `FdMatch.bookings?` added.
- 2026-05-19: `syncFixtures` prefetches teams (one query instead of ~128), derives `bracket_slot` deterministically per knockout stage, and invokes `score_tournament` when the Final lands.
- 2026-05-19: `seedTeams` collapses the two-pass player upsert into a single call with `team_id` populated.
