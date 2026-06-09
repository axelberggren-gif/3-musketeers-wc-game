> **Canon** — current source of truth. If reality and this file disagree, fix this file in the same PR.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 3 Musketeers WC Bet Game — root brief for AI agents

This is the canonical entry point for any AI coding agent (Claude Code, Codex, Cursor,
Aider, Copilot, etc.) working in this repo. Claude Code loads it via the `@AGENTS.md`
import in `CLAUDE.md`. Other agents read it directly.

## Project at a glance

- **Stack**: Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind v4 + Supabase
  (Postgres + Auth + Realtime + pg_cron) + football-data.org API.
- **Purpose**: friends-only World Cup 2026 betting league. Two prediction rounds:
  group-stage 1X2 picks + tournament props (round 1), knockout bracket (round 2).
- **Team**: four humans collaborating, all via Claude Code (or other AI agents). **No
  file ownership** — anyone may edit anything.
- **Lifecycle**: one-shot project tied to WC 2026. No semver, no long-term maintenance.

## Session-start ritual (do this every session, in order)

1. Read this file (Claude Code: auto-loaded via root `CLAUDE.md`'s `@AGENTS.md` import).
2. `tail -n 60 CHANGELOG.md` — see what teammates shipped recently.
3. `git log --oneline -10 && git status` — see what's in flight and on your tree.
4. Read the per-directory `CLAUDE.md` for the area you'll touch (map below).
5. Verify your git identity: `git config user.name` must be a **human name**, not
   "Claude". If wrong, ask the human to fix — never set it yourself.
6. Read `/.claude-identity` (gitignored) for the human's initials, used in branch
   names and CHANGELOG attributions. If missing, ask the human to copy
   `/.claude-identity.example` to `/.claude-identity` and fill it in.

## Per-directory CLAUDE.md map

Claude Code resolves these `@`-imports automatically; other agents should open them
when they touch the corresponding area.

@app/CLAUDE.md
@app/api/cron/CLAUDE.md
@lib/supabase/CLAUDE.md
@lib/scoring/CLAUDE.md
@lib/football-data/CLAUDE.md
@lib/stats/CLAUDE.md
@supabase/migrations/CLAUDE.md
@components/predict/CLAUDE.md
@components/banter/CLAUDE.md
@components/league-bets/CLAUDE.md
@components/stats/CLAUDE.md
@analytics/CLAUDE.md

## Global invariants (do not break)

- **Points sync**: values in `lib/scoring/rules.ts` MUST equal values in
  `supabase/migrations/0002_scoring.sql` (`points_*` SQL functions). Any change is a
  two-file edit; see `lib/scoring/CLAUDE.md`.
- **Scoring idempotency**: all writes to `point_awards` go through
  `score_match()` / `score_bracket()` / `score_*()` SQL functions, which use
  `idempotency_key` to dedupe. Never bypass with raw inserts.
- **RLS is the source of truth** for who sees whose picks. Don't ship API routes
  that leak picks before kickoff.
- **Migrations are append-only**. Never edit a merged migration file. Add a new
  numbered one (`0004_*.sql`, `0005_*.sql`, …).
- **Cron auth**: every handler under `app/api/cron/*` MUST verify `CRON_SECRET`. See
  `app/api/cron/CLAUDE.md`.
- **CI must pass**: `npm run lint && npm run typecheck && npm run build` are required
  on every PR. The workflow runs them automatically; ensure they pass locally too.
- **Git identity**: never run `git config user.name` or `git config user.email`. The
  human sets those once per clone; overwriting impersonates them.
- **AI co-author trailer**: every commit you author MUST end with the trailer
  `Co-authored-by: Claude <noreply@anthropic.com>` (or the appropriate trailer for
  your agent). This makes AI-assisted commits queryable.

## Workflow

### Branches

`<type>/<initials>/<short-kebab>` where `<type>` is one of: `feat`, `fix`, `chore`,
`docs`, `refactor`, `perf`, `ci`, `revert`. Examples:

- `feat/ax/leaderboard-tiebreaker`
- `fix/ma/bracket-empty-slot`
- `docs/jo/scoring-readme`

Get initials from `/.claude-identity`. Branch off `main`.

### Commits

[Conventional Commits](https://www.conventionalcommits.org). Examples:

- `feat(scoring): add tiebreaker on away-pick accuracy`
- `fix(bracket): handle zero-team slot without crashing`
- `chore(deps): bump eslint to 9.18`
- `docs(lib/scoring): document points sync invariant`

Squash-merge is the only merge strategy on `main`, so the **PR title** becomes the
commit on `main` — title must be Conventional Commits format.

### PRs

1. Push your branch, open a PR against `main`.
2. PR title = Conventional Commits (lint enforced by `pr-title-lint` workflow).
3. Fill in the PR template (`.github/pull_request_template.md`).
4. Update `CHANGELOG.md` in the same PR — one line at the top of the relevant
   subsection.
5. If you touched a directory with a `CLAUDE.md`, update its "Recent changes" list
   (newest first, keep last ~10).
6. Wait for `ci` + `pr-title-lint` checks to be green. No reviewer approval
   required (no-ownership policy), but checks are required.
7. Squash-merge.

### Task tracking

GitHub Issues is the team's tracker, organised as a kanban board via a
GitHub Project on the repo. Use the GitHub MCP tools available in Claude
Code sessions to read, create, and comment on issues. Reference issue IDs
in **PR descriptions** and **commit trailers** only (e.g. `Closes #42` or
`Refs: #42`); never in source code, code comments, or any `CLAUDE.md`.
The codebase stays tracker-agnostic so we can switch trackers later
without a search-and-replace.

**Filing**: pick one of the issue forms in `.github/ISSUE_TEMPLATE/`
(`Task`, `Bug`, `Idea`). Blank issues are disabled. Templates auto-apply
the matching `type:*` label.

**Labels** (declared in `.github/labels.yml`, synced by the
`sync-labels` workflow on push-to-main or manual dispatch):

- `type:*` — `bug`, `idea`, `task`, `docs`. Auto-applied by the template.
- `area:*` — `scoring`, `predict`, `admin`, `supabase`, `football-data`,
  `infra`, `ui`. Apply at least one during triage.
- `prio:*` — `P0` (blocks shipping), `P1` (important), `P2` (nice to have).
- `status:blocked` — waiting on something. Use sparingly; the Project
  column should already reflect status.
- `good-first-issue` — small, well-scoped pickups.

**Board** (GitHub Project on the repo, created in the GitHub UI):
columns are `Backlog` → `Up next` → `In progress` → `In review` → `Done`.
Enable the Project's built-in workflows so linking a PR with `Closes #N`
moves the issue to `In review` on PR open and `Done` on merge.

**Closing**: PR descriptions use `Closes #N` to auto-close the issue at
merge. For multi-PR work or partial progress, use `Refs: #N` instead.

## Required scripts (already in `package.json`)

- `npm run dev` — local dev server (port 3000).
- `npm run build` — production build (catches Next.js 16 build-time issues).
- `npm run lint` — ESLint.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run db:types` — regenerate `lib/supabase/types.ts` from local Supabase schema.

## Environment variables

See `.env.example` for the full set. Required for runtime: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FOOTBALL_DATA_TOKEN`,
`CRON_SECRET`. Optional: `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT` at build time) — when unset, the Sentry integration no-ops.

## Error tracking (Sentry)

Errors and session replays land in Sentry. The integration is gated on
`NEXT_PUBLIC_SENTRY_DSN` so local/CI builds without the env vars no-op cleanly.

- Files: `/instrumentation-client.ts`, `/instrumentation.ts`, `/sentry.server.config.ts`,
  `/sentry.edge.config.ts`, `/app/global-error.tsx`, `/lib/sentry/` — see
  `lib/sentry/CLAUDE.md`.
- Server-action `catch` blocks: import `captureServerActionError` from
  `@/lib/sentry/capture` and call it inside `catch` to surface handled errors.
- Cron route handlers: call `Sentry.captureException(e, { tags: { cron: "<name>" } })`
  inside the `catch` block.
- **Never** call `Sentry.setUser` with `email`. Use `{ id, username }` only.
- Session replay is **errors-only** + masks all inputs (covers the login email).
- Agent integration: add the Sentry MCP server to your Claude Code config:
  ```json
  { "mcpServers": { "sentry": { "url": "https://mcp.sentry.dev/mcp" } } }
  ```
  OAuth triggers on first use. Exposes `find_issues`, `get_issue_details`,
  `analyze_issue_with_seer`, etc.
