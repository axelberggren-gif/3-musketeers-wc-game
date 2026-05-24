> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

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
- 2026-05-24: `0009_redeem_league_invite_citext_cast.sql` — Sentry caught `42804: structure of query does not match function result type` once migration 0004 was applied to prod: the function declared `league_slug text` but `leagues.slug` is `citext`, so the success-path `select true, inv.slug, null::text` mismatched column 2. Casts the slug to `text` in the success branch (`inv.slug::text`). Signature unchanged; TS callers untouched.
- 2026-05-22: `0008_rls_security_definer_helper.sql` — Sentry confirmed the OR'd `user_id = auth.uid()` bootstrap from 0006 didn't actually break the recursion. Postgres evaluates the OR'd EXISTS subquery regardless of short-circuiting and raises `infinite recursion detected in policy for relation "league_members"`. New `is_league_member(league_id, user_id)` SECURITY DEFINER function bypasses RLS for the membership check; `league_members_read_self_leagues` and `leagues_read_members` now both route through it instead of EXISTS'ing back into `league_members`.
- 2026-05-22: `0007_leagues_owner_base_case.sql` — 0006 wasn't enough; users still hit "League created but not visible to you" on prod. Adds an `owner_id = auth.uid()` base case to `leagues_read_members` so a creator can read their league back regardless of how the `league_members` EXISTS subquery resolves. Also adds a `debug_auth_uid()` SQL function used by the createLeague action to capture the PostgREST-side `auth.uid()` into Sentry when the visibility check still fails.
- 2026-05-22: `0006_fix_league_members_rls.sql` — adds a `user_id = auth.uid()` bootstrap clause to `league_members_read_self_leagues` so the policy isn't fully self-referential. Without it, the EXISTS subquery hit Postgres' RLS recursion-breaker on freshly-created leagues, hiding the creator's own membership row and (via the `leagues_read_members` EXISTS check) the league itself — the root cause of the post-create 404.
- 2026-05-22: `0005_more_tournament_props.sql` — five new tournament-wide props (total goals, highest-match goals, troublemaker, group winners ×12, first eliminated); rewrites dark-horse scoring as rank-based (`teams.fifa_ranking`); adds `matches.details_synced_at` marker; extends `score_tournament` to chain into the new scorers.
- 2026-05-19: `0004_score_fixes.sql` — accumulate row counts across all INSERTs in `score_bracket`/`score_tournament`; add `redeem_league_invite(token, user_id)` for atomic invite consumption.
