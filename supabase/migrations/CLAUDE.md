# supabase/migrations/ — Postgres schema, RLS, scoring, cron

## Purpose
SQL migrations applied in lexical order to the Supabase project. Defines tables, RLS
policies, lock triggers, scoring functions, the leaderboard view, and the pg_cron job
schedule that polls football-data.org.

## Key files
- `0001_init.sql` — Tables, enums, RLS policies, lock triggers. The foundation.
- `0002_scoring.sql` — `points_*` constant functions, `score_match`, `score_bracket`,
  `score_tournament_props`, `score_player_props`, `refresh_league_standings` view.
- `0003_cron.sql` — `pg_cron` + `pg_net` setup, `call_cron_endpoint()` helper,
  `sync_fixtures` (every 10 min) and `sync_scorers` (daily 06:00 UTC) schedules.

## Conventions
- File naming: `NNNN_<short_name>.sql`, four-digit zero-padded sequence. Next free
  number is whatever follows the highest existing file.
- Functions are `create or replace` so re-applying a migration is safe. Tables use
  `create table if not exists`; enums use `do $$ ... exception when duplicate_object
  then null; end $$;`.
- Scoring functions are `security definer` with `set search_path = public` so they
  can be called from RLS contexts.

## Invariants (do not break)
- **Migrations are append-only**. Never edit a file that's been merged to `main`.
  Add a new numbered file to make changes.
- **Points sync** (mirrored from `lib/scoring/CLAUDE.md`): the `points_*` SQL
  functions in `0002_scoring.sql` MUST equal the `POINTS` object in
  `lib/scoring/rules.ts`. Any change is a two-file edit (a new migration here + the
  TS file).
- **RLS-first**: every user-facing table needs RLS policies. Picks must NOT be
  visible to other users before match kickoff — that's enforced by RLS, not the
  application layer.
- Scoring writes go through SQL functions, all using `point_awards.idempotency_key`
  to dedupe. Never raw-insert into `point_awards`.

## Known gotchas
- `0003_cron.sql` requires two Postgres GUCs set in the Supabase dashboard before
  apply: `app.cron_app_url` and `app.cron_secret`. Without them, `call_cron_endpoint()`
  silently `raise warning`s.
- Re-applying `0003_cron.sql` first unschedules existing jobs by name (`sync_fixtures`,
  `sync_scorers`) so it's idempotent. If you add a new cron job, follow the same
  pattern — unschedule by name, then re-schedule.
- After applying a migration that changes table schema, regenerate the TS types in
  `lib/supabase/types.ts` via `npm run db:types` and commit them in the same PR.

## Recent changes
<!-- Newest first. Keep last 10. One line per entry. -->
- 2026-05-19: `0004_score_fixes.sql` — accumulate row counts across all INSERTs in `score_bracket`/`score_tournament`; add `redeem_league_invite(token, user_id)` for atomic invite consumption.
