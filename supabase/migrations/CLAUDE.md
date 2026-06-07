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
- 2026-06-05: `0018_scoring_hygiene.sql` — scoring SQL hygiene, no point-value change. (1) `drop function if exists points_dark_horse()` — the flat-10 function was dead since 0005 made dark-horse rank-based; the only references live in the superseded `score_tournament()` bodies in 0002/0004 (PL/pgSQL bodies create no tracked function dependencies, so the drop is safe), and the live `score_tournament()` (0014) pays `teams.fifa_ranking`. It's absent from `lib/scoring/rules.ts` so points-sync is unaffected. (2) `score_bracket()` re-created identical to 0014 but with `bp.bracket_slot <> '3RD'` added to the keep-set in both the reconcile DELETE and the per-slot INSERT — a stray `bracket_slot='3RD'` prediction (only reachable via direct DB writes; the UI's `R32→R16→QF→SF→F→W` never offers it) previously minted a 0-point `bracket` award because `points_bracket_slot('3RD')` falls through to `else 0`. Now no new 3RD award is written and any pre-existing one is reaped on the next run. Totals unchanged.
- 2026-06-05: `0016_gate_tournament_drain.sql` — defers the two drain-dependent tournament categories so they never score on incomplete data right after the Final (#83). New SECURITY DEFINER helper `all_match_details_synced()` returns true once no FINISHED match has `details_synced_at IS NULL`. `score_troublemaker()` returns 0 early (after its existing Final-finished guard) until that's true; `score_tournament()` wraps only its top-scorer reconcile+award block in `if all_match_details_synced()`. Other categories (winner / runner-up / dark horse / player props / total goals / highest match) unchanged and still award immediately. Self-healing: `score_tournament()` re-runs every 10-min cron while the Final is FINISHED, so the gate opens once the per-match detail drain catches up (also accelerated by the repurposed `syncScorers()` daily backstop). `create or replace` only — no schema change, so no `npm run db:types` needed. Point values unchanged.
- 2026-06-04: `0015_profile_onboarding.sql` — adds `profiles.onboarded boolean not null default false`, driving the new `/welcome` username-picker gate in `app/(app)/layout.tsx`. `default false` applies to existing rows too, so every current account is prompted once on next login — intentional, since it retro-fixes already-joined members who only have an auto-generated handle. `handle_new_user()` is deliberately unchanged: its INSERT omits the column, so new rows inherit the `false` default. No RLS change (`profiles_update_self` from 0001 already covers the user's self-update). Types were hand-edited (`onboarded` on `profiles` Row/Insert/Update) because the dev DB hasn't applied the migration; `npm run db:types` reproduces the same once it has.
- 2026-06-01: `0014_reconcile_scoring.sql` — scorers now **reconcile** (delete-stale-then-insert) instead of insert-only, fixing permanently-inflated standings after a result correction. `point_awards.idempotency_key` encodes only (user, target), never the result, so `on conflict do nothing` could never revoke a now-wrong award when an admin override or a football-data revision flipped a winner. `score_match` / `score_bracket` / `score_tournament` (+ its sub-scorers `score_total_goals_guess` / `score_highest_match_goals_guess` / `score_troublemaker`) each first DELETE the awards they own that no longer match the current result, then re-INSERT the correct set. The delete predicate is stale-only (compares membership, plus `points` for the rank/split-derived awards: dark horse, total-goals, highest-match) so an unchanged run removes zero rows and stays idempotent under the 10-min cron. Point values unchanged — points-sync with `rules.ts` holds. **Known limitation**: one-shot group-stage settlements (`score_group_winner` / `score_first_eliminated`, gated by `group_settlements` / `first_elimination` rows) don't re-settle if a group result is corrected post-settlement — separate follow-up.
- 2026-05-26: `0013_add_r32_stage.sql` — adds `R32` to the `stage` enum (positioned BEFORE `R16` for natural ordinal sort) and extends `points_bracket_slot()` so `R32-%` slots are worth 1 pt. WC 2026's expanded format makes Round of 32 the first knockout round (12 group winners + 12 runners-up + 8 best 3rd-place = 32 teams). `score_bracket()` is unchanged — it joins on `bracket_slot` text so new R32-1..R32-16 slots score transparently once matches land. UI / auto-advancement / per-stage filtering arrives in follow-up PRs.
- 2026-05-25: `0011_banter.sql` — adds `banter_messages` + `banter_replies` (FK cascade on parent delete) for league chat. RLS gated by the existing `is_league_member(uuid, uuid)` helper plus a new `banter_message_league_id(uuid)` SECURITY DEFINER companion so the reply policies can resolve the parent's league_id without recursing through RLS on `banter_messages`. 1..180 char body CHECK constraint; indices on `(league_id, created_at desc)` and `(message_id, created_at asc)`. Both tables registered with the `supabase_realtime` publication (idempotent via the `duplicate_object` swallow) so the `league:<id>:banter` channel receives INSERT/DELETE events.
- 2026-05-25: `0012_pick_reactions.sql` — polymorphic emoji reactions on picks. New table `pick_reactions(id, pick_id text, pick_kind text, user_id, emoji text, created_at)` with CHECK on `pick_kind ∈ {match, bracket, tournament, prop}` and `emoji ∈ {🔥, 💩, 😱, 👍}`, plus `unique (pick_id, pick_kind, user_id, emoji)` for toggle semantics. Two SELECT policies (UNIONed): `pr_read_self` and `pr_read_league_mate` (inline EXISTS over `league_members` joined to itself — mirrors `mp_read_after_kickoff`, no recursion concern); `pr_write_self` for all writes. `pick_id` is text (not uuid) because targets are polymorphic across four prediction tables; v1 UI wires only the `match` kind. No FK on `pick_id` — orphan cleanup is a future sweeper. Closes #36 data layer.
- 2026-05-24: `0010_backfill_team_group_letter.sql` — adds `backfill_team_group_letters()` SECURITY DEFINER RPC that derives `teams.group_letter` from group-stage `matches.group_letter` (distinct-on per team, won't override if already correct). `seedTeams()` never wrote `group_letter` (football-data's /teams payload has no group info) so the column was permanently NULL, yet `GroupWinnerPicker` and `score_first_eliminated` both read it. Now invoked from `syncFixtures()` after the match upsert loop. Also serves as the recovery path for the parser bug fixed in the same PR — previously `m.group.replace("Group ", "").slice(0, 1)` returned "G" for every group because the v4 API format is `GROUP_A`, not `Group A`.
- 2026-05-24: `0009_redeem_league_invite_citext_cast.sql` — Sentry caught `42804: structure of query does not match function result type` once migration 0004 was applied to prod: the function declared `league_slug text` but `leagues.slug` is `citext`, so the success-path `select true, inv.slug, null::text` mismatched column 2. Casts the slug to `text` in the success branch (`inv.slug::text`). Signature unchanged; TS callers untouched.
- 2026-05-22: `0008_rls_security_definer_helper.sql` — Sentry confirmed the OR'd `user_id = auth.uid()` bootstrap from 0006 didn't actually break the recursion. Postgres evaluates the OR'd EXISTS subquery regardless of short-circuiting and raises `infinite recursion detected in policy for relation "league_members"`. New `is_league_member(league_id, user_id)` SECURITY DEFINER function bypasses RLS for the membership check; `league_members_read_self_leagues` and `leagues_read_members` now both route through it instead of EXISTS'ing back into `league_members`.
- 2026-05-22: `0007_leagues_owner_base_case.sql` — 0006 wasn't enough; users still hit "League created but not visible to you" on prod. Adds an `owner_id = auth.uid()` base case to `leagues_read_members` so a creator can read their league back regardless of how the `league_members` EXISTS subquery resolves. Also adds a `debug_auth_uid()` SQL function used by the createLeague action to capture the PostgREST-side `auth.uid()` into Sentry when the visibility check still fails.
- 2026-05-22: `0006_fix_league_members_rls.sql` — adds a `user_id = auth.uid()` bootstrap clause to `league_members_read_self_leagues` so the policy isn't fully self-referential. Without it, the EXISTS subquery hit Postgres' RLS recursion-breaker on freshly-created leagues, hiding the creator's own membership row and (via the `leagues_read_members` EXISTS check) the league itself — the root cause of the post-create 404.
- 2026-05-22: `0005_more_tournament_props.sql` — five new tournament-wide props (total goals, highest-match goals, troublemaker, group winners ×12, first eliminated); rewrites dark-horse scoring as rank-based (`teams.fifa_ranking`); adds `matches.details_synced_at` marker; extends `score_tournament` to chain into the new scorers.
- 2026-05-19: `0004_score_fixes.sql` — accumulate row counts across all INSERTs in `score_bracket`/`score_tournament`; add `redeem_league_invite(token, user_id)` for atomic invite consumption.
