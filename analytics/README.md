# Agent Product Analytics

This repo is built by AI coding agents. Traditional analytics watch human sessions; here the
"user" is an agent, so we instrument **the agents' work** instead. A **PR is one agent run**,
the **`area:*` label is the workflow**, and **corrections** (post-merge fixes, reverts, review
CHANGES_REQUESTED) are a free label set. We read it through the four-quadrant
completion-vs-acceptance framework to see which workflows agents can ship unattended and which
need a human in the loop.

It runs on data you already have — git history + GitHub — so there's nothing to instrument in
the product and no new dependencies.

## Commands

```bash
npm run agent:report                 # four-quadrant report (fresh, from git history) → Markdown
npm run agent:report -- --since 2026-05-01
npm run agent:backfill               # write the event snapshot → analytics/events/log.ndjson
npm run agent:evals                  # draft eval-case stubs from corrections (stdout)
```

Add `-- --no-github` to force git-only (default tries `gh` enrichment when available). In CI,
`gh` is present and adds true completion + the review bot's CHANGES_REQUESTED signal.

## How it fits together

```
git log --first-parent + GitHub (PRs/reviews/CI/labels) + CHANGELOG
        │  collect.mjs  (parse → classify → normalize)
        ▼
   events  ── backfill.mjs ─▶ events/log.ndjson (committed snapshot)
        │
        ├─ report.mjs            ─▶ four-quadrant report  (Prompt 03)
        └─ correction-to-eval.mjs ─▶ eval stubs ─▶ prompts/02 ─▶ evals/cases/*.json (Prompt 02)
```

- **Backfill** = recompute from full history anytime.
- **Live** = the `agent-analytics` GitHub Action recomputes and upserts a tracking issue weekly
  and on every merged PR (it commits nothing — `main` is branch-protected).
- **Eval loop** = corrections become regression tests under `evals/cases/`, validated by `npm test`.

See `prompts/01-instrument.md` for the event catalog and the path/label resolution rules.

## Optional: local session telemetry (opt-in)

Claude Code hooks **don't run on the web**, so the GitHub Action above is the universal pipeline.
If you work in the **local** CLI/desktop app and want richer session signal, opt in *personally*
by adding this to your gitignored `.claude/settings.local.json` (not the shared `settings.json`):

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node analytics/scripts/hook-emit.mjs agent_run_started" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node analytics/scripts/hook-emit.mjs task_completed" }] }]
  }
}
```

It appends thin rows to `analytics/events/local.ndjson` (gitignored) and always exits 0. Not
wired into the report yet — it's groundwork for the roadmap events in `prompts/01-instrument.md`.
