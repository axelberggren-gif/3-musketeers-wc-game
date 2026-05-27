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
- 2026-05-26: `authorized()` helper extracted to `lib/cron/auth.ts` as `authorizedCron(request)` and deduped between `sync-fixtures/route.ts` and `sync-scorers/route.ts`. Secret comparison now uses `crypto.timingSafeEqual` (with a length-mismatch short-circuit so the timing-safe path never sees mismatched-length buffers) instead of `===`. Refs #17.
- 2026-05-22: Both `sync-fixtures` and `sync-scorers` catch blocks now call `Sentry.captureException(e, { tags: { cron: "..." } })` before returning the JSON error. No-op when `NEXT_PUBLIC_SENTRY_DSN` is unset.
