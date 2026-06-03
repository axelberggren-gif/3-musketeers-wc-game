# Prompt 1 (adapted) — Agent instrumentation for THIS repo

> Prompt-kit Prompt 1 asks four questions (language, framework, sink, workflows). For this
> repo they're already answered — this doc records the answers and the schema so you don't
> regenerate boilerplate. Use it when extending the event catalog.

## Pre-answered inputs

- **Language / runtime:** TypeScript repo; analytics tooling is plain Node ESM (`.mjs`,
  Node 20+) with **zero new dependencies** (mirrors `scripts/test-supabase.mjs`).
- **Agent framework:** none in-product. The "agent" is Claude Code (web + CLI) and the
  `anthropics/claude-code-action` review bot. **The unit of a run = a GitHub PR.**
- **Sink:** git + GitHub history is the source of truth (recomputed on demand). A committed
  snapshot lives at `analytics/events/log.ndjson`; optional local-session telemetry lands in
  `analytics/events/local.ndjson` (gitignored, from Claude Code hooks).
- **Workflows (`workflow_type`):** the `area:*` labels — `scoring`, `predict`, `admin`,
  `supabase`, `football-data`, `infra`, `ui` — with finer conventional scopes (`auth`, …)
  passing through. Resolved from: gh `area:*` label → conventional scope → changed-file
  paths → branch slug.

## The three starter events (see `analytics/schema.mjs`)

| Event | Fires when (this repo) | Key fields |
| --- | --- | --- |
| `agent_run_started` | A PR lands on mainline (squash commit or merge commit). | `intent_summary` (PR title), `trigger_source` (`squash`/`merge`) |
| `task_completed` | The run reaches a terminal state. | `status` (`completed`/`partial`/`failed`) — `failed` needs gh (closed-unmerged PRs aren't in git) |
| `user_correction_submitted` | A post-merge `fix`/`revert`, a corrective branch slug, the review bot's CHANGES_REQUESTED, or a CHANGELOG "Round N"/"caught in review" marker. | `correction_type`, `severity`, `review_driven`, `description` |

`agent_run_id` (`PR-<n>`) is the shared key tying all events for one run together.

## Expansion roadmap — the other seven events

Add these one at a time as a workflow reveals it needs deeper signal. Hook/source noted:

- `tool_call_failed` — a CI step (lint/typecheck/test/build) failed → fixed (gh `check-runs`); or a local `PostToolUseFailure` hook.
- `approval_denied` — review bot `CHANGES_REQUESTED` (gh `pulls/{n}/reviews`). Already emitted as a correction when gh-enriched.
- `permission_blocked` — local `PreToolUse` deny hook only (not visible from GitHub).
- `memory_miss` — bot review citing a documented invariant (e.g. "migrations append-only").
- `escalation_triggered` — PR labelled `status:blocked`, or a human takes over a branch.
- `task_abandoned` — branch with agent commits but no PR, or a PR closed unmerged (gh).
- `business_outcome_recorded` — merge → Vercel prod deploy success / linked issue closed (gh deployments / `Closes #N`).

Keep emission off the critical path and fail-safe — analytics must never break a build or a session.
