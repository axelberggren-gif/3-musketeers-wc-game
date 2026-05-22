# Changelog

> **Non-canon** — historical record. Entries describe state at the time of the PR and may be stale; do not treat as current behaviour. For canonical behaviour, read the per-directory `CLAUDE.md`.

All notable changes to this project. Each PR appends one line to the relevant subsection,
newest first. Entry format:

```
- YYYY-MM-DD (`abcd123`) Short description — @initials
```

After committing your change, run `git commit --amend --no-edit` once to backfill the
7-char short hash before pushing.

## [Unreleased]

### Added
- 2026-05-22 (`pending`) Sticker Stadium visual identity across every user-facing route: cream paper background + halftone dot pattern, Archivo Black headlines, ink-borders + chunky 6px offset shadows, gold/coral/pitch accent palette, sticker primitives in `globals.css`. Group chip strip on `/predict` flips to pitch-green ✓ when all matches in that group are picked. `DESIGN_MISALIGNMENTS.md` tracks features in the design (banter, pick reactions, Pulse stats, Pick personality, bracket progressive reveal, album progress, live-count pill) that this PR did not implement — @claude
- 2026-05-22 (`pending`) Five new tournament-wide bets — total goals (closest wins, ties split), highest-scoring match goal count, troublemaker (most card weight), group winners (×12), first team eliminated — plus rank-based dark-horse scoring (points = team's FIFA rank if pick reaches QF). Canonical TS ranks in `lib/scoring/fifa-rankings.ts`, seeded into `teams.fifa_ranking` by migration 0005 — @ax
- 2026-05-22 (`pending`) `syncFixtures` now drains per-match bookings/goals from `/matches/{id}` (capped at 5/run for rate limit), populating `player_goal_log` and the new `player_card_log` so the troublemaker and golden-boot props have data — @ax
- 2026-05-19 (`pending`) Vitest unit tests for scoring rules, lock state, and football-data mappers; wired into CI — @?
- 2026-05-19 (`pending`) `unwrapRelation` helper centralises the PostgREST single-vs-array embedded-relation cast — @?

### Changed
- 2026-05-19 (`pending`) `syncFixtures` prefetches teams (eliminating ~128 round-trips/run) and invokes `score_tournament` once the Final lands — @?
- 2026-05-19 (`pending`) `overrideMatchResult` re-scores the tournament after an admin override and validates score inputs server-side — @?
- 2026-05-19 (`pending`) `loadProfileStats` gates accuracy on the viewer being the profile owner — @?

### Fixed
- 2026-05-22 (`pending`) Round 3 of the league-creation visibility bug. Migration `0006_fix_league_members_rls.sql` wasn't enough; users still saw "League created but not visible to you" in production. Migration `0007_leagues_owner_base_case.sql` adds an `owner_id = auth.uid()` base case directly to `leagues_read_members` so a creator can read their league back regardless of how the `league_members` EXISTS subquery resolves. Also adds a `debug_auth_uid()` SQL function; the `createLeague` action now calls it (plus probes the user's own profile and league_members rows) and captures the results to Sentry as `extra` data on the same `captureMessage`, so the next time anyone hits this we'll see the PostgREST-side `auth.uid()`, whether `role=authenticated` (profile readable), and whether the user's own membership row is RLS-visible — @ax
- 2026-05-22 (`pending`) Root cause of the league-creation 404 — finally. The `league_members_read_self_leagues` RLS policy was fully self-referential: to read any row in `league_members` you needed to find another row in `league_members` for the same league, which is the very thing the policy was supposed to gate. Postgres' RLS recursion-breaker returned false, so a user couldn't see their own freshly-inserted membership row. That cascaded into `leagues_read_members`' EXISTS check returning false, so the brand-new league was invisible to its creator. Migration `0006_fix_league_members_rls.sql` adds a `user_id = auth.uid()` bootstrap clause so the policy has a non-recursive base case. The Sentry-tagged sanity check added in #24 confirmed the symptom in production — @ax
- 2026-05-22 (`pending`) League creation 404 — round 2 follow-up to #23. The previous fix used `router.push()` after a `{ ok, slug }` return, but the bug still reproduced in production. Switched `CreateLeagueForm` to the canonical `useActionState` + `<form action={action}>` pattern so the action's `redirect()` propagates through React's form action handling. Added an RLS-aware visibility sanity check inside `createLeague`: after both inserts, query the new league back through the user's RLS-aware client. If the user can't see their own league, roll both inserts back, capture to Sentry with `user_id`/`league_id`/`slug`, and return an explicit error to the form instead of letting the redirect land on a 404 — @ax
- 2026-05-22 (`pending`) League creation hit a 404 right after submit: the `league_members` insert error was ignored (so a silent failure left the user non-member, RLS hid the league, slug page called `notFound()`), and the server-action `redirect()` was unreliable when invoked via `await` inside `startTransition` from a client wrapper. Action now checks the member insert, rolls back the league on failure, and returns `{ ok, slug }` so the client navigates via `router.push()` — @ax
- 2026-05-19 (`pending`) P0: bracket scoring was a no-op because `matches.bracket_slot` was never populated; sync now derives it deterministically per knockout stage — @?
- 2026-05-19 (`pending`) `score_bracket` / `score_tournament` returned only the last INSERT's row count; both now accumulate across every insert — @?
- 2026-05-19 (`pending`) Invite redemption race (concurrent joins could exceed `max_uses`) replaced with atomic `redeem_league_invite` RPC — @?

### Removed

### Infra
- 2026-05-22 (`pending`) Sentry integration for error tracking + errors-only session replay. Adds `@sentry/nextjs`, root-level `instrumentation-client.ts` / `instrumentation.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`, `app/global-error.tsx`, `lib/sentry/capture.ts`. `next.config.ts` wrapped in `withSentryConfig` (source-map upload skipped when `SENTRY_AUTH_TOKEN` unset). Admin server actions + cron routes tag exceptions on capture. `Sentry.setUser({ id, username })` from `(app)/layout.tsx` (never email). Integration no-ops without `NEXT_PUBLIC_SENTRY_DSN`. `.env.example` added — @ax
- 2026-05-20 (`pending`) GitHub Issues tracker scaffolded: issue forms (Task/Bug/Idea), `.github/labels.yml` + `sync-labels` workflow, PR template gets a `Closes #N` slot, AGENTS.md documents the kanban workflow — @ax
- 2026-05-20 (`pending`) Agent-native tooling pass: `verifier` subagent, husky pre-commit (lint+typecheck), canon/non-canon banners on every `CLAUDE.md` and `CHANGELOG`, `/.claude-identity.example` template, GitHub Issues codified as the tracker — @ax
- 2026-05-19 (`pending`) Migration 0004: row-count fixes for `score_bracket`/`score_tournament` plus `redeem_league_invite` RPC — @?
