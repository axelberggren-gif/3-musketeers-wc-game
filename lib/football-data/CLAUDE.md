# lib/football-data/ — football-data.org API client + sync

## Purpose
Wrapper around the football-data.org REST API plus the sync functions that pull teams,
players, matches, and scorers into our Supabase tables. Called from the cron handlers
in `app/api/cron/` and from admin actions.

## Key files
- `client.ts` — `FootballDataClient` class (low-level fetch wrapper) + stage/winner/
  status mappers from football-data enums → our DB enums.
- `sync.ts` — `seedTeams()`, `syncFixtures()`, `syncScorers()` server-side functions.
  Use `supabaseService()` (RLS bypass) and log to `external_sync_log`.

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
- `seedTeams()` does a two-step player upsert (insert base row first, then patch
  `team_id`) because the local team UUID is only known after the team upsert.
- `syncFixtures()` calls SQL RPCs `score_match`, `score_bracket`, and
  `refresh_league_standings` after upserting finished matches. Those functions live
  in migration 0002 — keep them in sync.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
