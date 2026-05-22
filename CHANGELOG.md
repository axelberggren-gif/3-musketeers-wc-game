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
- 2026-05-22 (`pending`) Five new tournament-wide bets — total goals (closest wins, ties split), highest-scoring match goal count, troublemaker (most card weight), group winners (×12), first team eliminated — plus rank-based dark-horse scoring (points = team's FIFA rank if pick reaches QF). Canonical TS ranks in `lib/scoring/fifa-rankings.ts`, seeded into `teams.fifa_ranking` by migration 0005 — @ax
- 2026-05-22 (`pending`) `syncFixtures` now drains per-match bookings/goals from `/matches/{id}` (capped at 5/run for rate limit), populating `player_goal_log` and the new `player_card_log` so the troublemaker and golden-boot props have data — @ax
- 2026-05-19 (`pending`) Vitest unit tests for scoring rules, lock state, and football-data mappers; wired into CI — @?
- 2026-05-19 (`pending`) `unwrapRelation` helper centralises the PostgREST single-vs-array embedded-relation cast — @?

### Changed
- 2026-05-19 (`pending`) `syncFixtures` prefetches teams (eliminating ~128 round-trips/run) and invokes `score_tournament` once the Final lands — @?
- 2026-05-19 (`pending`) `overrideMatchResult` re-scores the tournament after an admin override and validates score inputs server-side — @?
- 2026-05-19 (`pending`) `loadProfileStats` gates accuracy on the viewer being the profile owner — @?

### Fixed
- 2026-05-19 (`pending`) P0: bracket scoring was a no-op because `matches.bracket_slot` was never populated; sync now derives it deterministically per knockout stage — @?
- 2026-05-19 (`pending`) `score_bracket` / `score_tournament` returned only the last INSERT's row count; both now accumulate across every insert — @?
- 2026-05-19 (`pending`) Invite redemption race (concurrent joins could exceed `max_uses`) replaced with atomic `redeem_league_invite` RPC — @?

### Removed

### Infra
- 2026-05-20 (`pending`) GitHub Issues tracker scaffolded: issue forms (Task/Bug/Idea), `.github/labels.yml` + `sync-labels` workflow, PR template gets a `Closes #N` slot, AGENTS.md documents the kanban workflow — @ax
- 2026-05-20 (`pending`) Agent-native tooling pass: `verifier` subagent, husky pre-commit (lint+typecheck), canon/non-canon banners on every `CLAUDE.md` and `CHANGELOG`, `/.claude-identity.example` template, GitHub Issues codified as the tracker — @ax
- 2026-05-19 (`pending`) Migration 0004: row-count fixes for `score_bracket`/`score_tournament` plus `redeem_league_invite` RPC — @?
