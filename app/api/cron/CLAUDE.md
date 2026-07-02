> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# app/api/cron/ — pg_cron-triggered sync endpoints

## Purpose
HTTP endpoints invoked by Postgres `pg_cron` jobs (via `pg_net`) to pull data from
football-data.org and update our database. They are also callable manually from the
admin UI for ad-hoc syncs.

## Key files
- `sync-fixtures/route.ts` — POST/GET. Calls `syncFixtures()` from
  `lib/football-data/sync.ts`. Scheduled every 10 minutes.
- `sync-scorers/route.ts` — POST/GET. Calls `syncScorers()`. Scheduled daily 06:00 UTC.
  Despite the name, this is the **detail-drain + reconcile backstop**, not a scorers
  fetch: it drains any FINISHED-match goal/card backlog the 10-min fixtures cron
  hasn't reached (cap 8/run — no list call, so the full 10/min budget is for details),
  then re-runs `score_tournament()` + `refresh_league_standings`. This is what lets
  the drain-gated top-scorer / troublemaker categories settle on complete data (#83).

## Conventions
- Every handler exports `runtime = "nodejs"` and `dynamic = "force-dynamic"` — these
  endpoints must never be statically rendered or edge-cached.
- Both `POST` and `GET` are accepted; `GET` delegates to `POST`. pg_cron uses POST;
  GET is for manual debugging from a browser tab.
- All work is delegated to `lib/football-data/sync.ts`. The route handler is a thin
  shell: auth check → call sync function → return JSON.
- Errors are caught and returned as `{ ok: false, error }` with HTTP 500. They're also
  logged to the `external_sync_log` table by the sync functions.

## Invariants (do not break)
- **Every cron handler MUST verify `CRON_SECRET`** via the `x-cron-secret` header or
  `Authorization: Bearer <secret>`. Without it, return 401 immediately. Use the
  shared `authorizedCron(request)` helper from `@/lib/cron/auth` — it compares the
  header against the secret with `crypto.timingSafeEqual` (length-mismatch
  short-circuits first). Never roll a per-route copy; the central helper is the
  single source of truth.
- The pg_cron schedule is defined in `supabase/migrations/0003_cron.sql`. If you add
  a new cron endpoint here, you MUST add a `cron.schedule(...)` call in a new
  migration (migrations are append-only — don't edit 0003).
- Sync functions are idempotent — safe to re-run. If you add a new one, preserve that
  property (use `point_awards.idempotency_key`, `onConflict` upserts, etc.).

## Known gotchas
- The hosted Supabase project needs `app.cron_app_url` and `app.cron_secret` Postgres
  GUCs set (Settings → Database → Custom Postgres config) for pg_cron to actually
  reach the deployed Next.js endpoints. See header comment in
  `supabase/migrations/0003_cron.sql`.
- football-data.org free tier rate limits to 10 requests/minute. `syncFixtures` does
  many lookups per call; keep an eye on this if you add new fan-out behaviour.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-07-01: A mis-configured cron is now **visible in the admin dashboard's "Recent sync log"**. When `app.cron_app_url` / `app.cron_secret` are unset, `call_cron_endpoint()` (migration `0035_cron_config_observability.sql`) writes an `external_sync_log` row (`source='pg_cron'`) explaining the fix, instead of only `raise warning`ing into the invisible Postgres logs while the pg_cron job still reports `succeeded`. This is the silent hole that let the `*/10` sync do nothing for weeks after an infra event wiped the GUCs. No route-handler change.
- 2026-06-30: Both cron route handlers now `export const maxDuration = 60`, and the pg_net call in `call_cron_endpoint()` (migration `0034_cron_http_timeout.sql`) passes `timeout_milliseconds := 30000`. Root cause of "the */10 cron never updates, I have to sync manually": pg_net aborted at its **5000 ms default** on every run (`net._http_response.error_msg` = "Timeout of 5000 ms reached", DNS + TCP/SSL handshake fine), because `syncFixtures()` takes longer than 5 s (football-data list + up to 5 detail fetches under a 10-req/min limit + ~104 upserts + scoring RPCs). The admin "Sync fixtures" button calls `syncFixtures()` in-process (no HTTP, no timeout), which is why manual always worked. Raising the pg_net timeout needs the matching `maxDuration` or Vercel's low platform default would kill the function first.
- 2026-06-05: `sync-scorers` repurposed (#83). `syncScorers()` no longer fetches the informational `/scorers` list (it fed no scoring table); it now drains up to 8 pending FINISHED-match details via `drainPendingMatchDetails()` then re-runs `score_tournament()` + `refresh_league_standings`, acting as the daily backstop to the 10-min fixtures drain. Pairs with migration 0016, which gates top-scorer / troublemaker on `all_match_details_synced()` so they never resolve on a partial drain backlog right after the Final. Route handler unchanged (thin shell). Budget: 8 detail fetches + the standings/scoring RPCs stay under 10 req/min.
- 2026-05-26: `authorized()` helper extracted to `lib/cron/auth.ts` as `authorizedCron(request)` and deduped between `sync-fixtures/route.ts` and `sync-scorers/route.ts`. Secret comparison now uses `crypto.timingSafeEqual` (with a length-mismatch short-circuit so the timing-safe path never sees mismatched-length buffers) instead of `===`. Refs #17.
- 2026-05-22: Both `sync-fixtures` and `sync-scorers` catch blocks now call `Sentry.captureException(e, { tags: { cron: "..." } })` before returning the JSON error. No-op when `NEXT_PUBLIC_SENTRY_DSN` is unset.
