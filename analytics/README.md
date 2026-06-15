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
npm run agent:dream                  # consolidate memory (the local "dream") → Markdown proposal
npm run agent:dream -- --focus scoring --engine heuristic
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
        ├─ correction-to-eval.mjs ─▶ eval stubs ─▶ prompts/02 ─▶ evals/cases/*.json (Prompt 02)
        └─ dream.mjs  +  the memory store (CLAUDE.md corpus + evals/cases) ─▶ consolidation
                         proposal: Merge / Replace / Surface  (Prompt 04)
```

- **Backfill** = recompute from full history anytime.
- **Live** = the `agent-analytics` GitHub Action recomputes and upserts a tracking issue weekly
  and on every merged PR (it commits nothing — `main` is branch-protected).
- **Eval loop** = corrections become regression tests under `evals/cases/`, validated by `npm test`.
- **Dream** = the local analog of a Managed-Agents
  [*dream*](https://platform.claude.com/docs/en/managed-agents/dreams). The pipeline above mines
  *transcripts* (corrections); `dream.mjs` adds the *consolidation* pass — it reads the agents'
  memory store (the `CLAUDE.md` canon + the eval suite) and proposes a reorganized memory
  (duplicates merged, stale entries replaced, new insights surfaced). It's **read-only**: like a
  real dream it never edits its inputs, so you adopt the parts you like (edit a CLAUDE.md, add an
  eval) or discard it. `--engine` picks the deterministic heuristic, the paste-into-Claude prompt
  bundle, or both; `--focus <area>` is the dream's `instructions` analog.

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
