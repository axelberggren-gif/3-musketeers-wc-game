> **Canon** — current source of truth for this directory. If reality and this file disagree, fix this file in the same PR.

# analytics/ — agent product analytics (meta, not product)

## Purpose
Instruments **the AI agents that build this repo** (not the betting-game product, which has no
in-product agents). Maps the "Agent Product Analytics" prompt-kit onto dev work: a **PR = an
agent run**, the **`area:*` label = the workflow**, and **corrections** (post-merge fixes,
reverts, review CHANGES_REQUESTED) are the free label set. The output is a four-quadrant
completion-vs-acceptance read that says which workflows agents can be trusted to ship and
which need a human in the loop. Self-contained: **no product runtime code, no new deps** —
plain Node ESM scripts over git + GitHub history.

## Key files
- `schema.mjs` — event-name constants + factory helpers (the 10-event catalog; 3 are emitted today).
- `lib/sources.mjs` — git first-parent reader, `gh` enrichment (best-effort), CHANGELOG attribution, changed-files.
- `lib/classify.mjs` — conventional-commit/merge parsing, area resolution (scope → file paths → branch slug), correction heuristics.
- `lib/collect.mjs` — orchestration; the shared core behind both scripts → normalized events.
- `scripts/backfill.mjs` — emit events from history (`npm run agent:backfill`).
- `scripts/report.mjs` — the four-quadrant report (`npm run agent:report`), Markdown.
- `scripts/correction-to-eval.mjs` — draft eval stubs from corrections (`npm run agent:evals`).
- `scripts/hook-emit.mjs` — optional local-session telemetry (opt-in; see README).
- `prompts/01..03` — the three adapted prompt-kit prompts.
- `evals/validate.ts` + `evals/cases.test.ts` + `evals/cases/*.json` — the regression suite the correction loop feeds.
- `events/log.ndjson` — committed snapshot (regenerate with `agent:backfill`); `events/local.ndjson` — gitignored local-hook sink.
- `reviewer-loop/` — self-improving loop for the PR review bot (the `prompt:` rubric in `.github/workflows/claude-review.yml`). `PLAYBOOK.md` is the propose→prove→open-a-PR procedure; `score.mjs` (`npm run review-loop:score`) is the deterministic recall/precision/verdict judge; `suite/` holds PR fixtures + answer keys; `candidates.ndjson` is the ideas log. Human (Axel) is the merge gate; the loop only opens PRs.

## Conventions
- Runnable code is `.mjs` (Node 20+, built-ins only), matching `scripts/test-supabase.mjs`. The
  only `.ts` here is `evals/validate.ts` + the test (kept strict-clean for `tsc`/`next build`).
- `agent_run_id` = `PR-<n>` (the durable, web+local unit). Everything joins on it.
- `workflow_type` resolves in priority order: gh `area:*` label → conventional scope → changed-file
  paths (`lib/scoring/`→scoring, `supabase/migrations/`→supabase, …) → branch slug → `unknown`.
- Reports state their thresholds + data-source caveats inline. Default completion ≥70% / acceptance ≥75%.

## Invariants (do not break)
- **Never touch the product runtime or DB.** This dir builds nothing into Next and adds no deps.
- **Fail-safe always.** Scripts and hooks must never break a build, a session, or CI — `gh`/git
  failures degrade gracefully; `hook-emit.mjs` always exits 0 and never writes stdout.
- **No CI commits to `main`.** `main` is branch-protected; the `agent-analytics` workflow
  recomputes and upserts a tracking issue — it commits nothing.
- **Eval cases must validate.** Every `evals/cases/*.json` matches `evals/validate.ts`; `npm test` enforces it.

## Known gotchas
- **git-only completion ≈ 100%**: closed/abandoned PRs never reach mainline, so the correction
  (acceptance) axis is load-bearing locally. GitHub enrichment (CI / `gh`) fills true completion.
- **Heuristic `workflow_type`**: mixed PRs bucket by dominant changed-file area (e.g. league
  work split between `ui` and `supabase`). Add `area:*` labels for authoritative classification.
- **Correction precision over recall**: only post-merge `fix`/`revert`, corrective branch slugs,
  gh CHANGES_REQUESTED, and CHANGELOG "Round N"/"caught in review" count. Pre-merge review fixes
  (squashed away) need gh enrichment. Word-bounded slug regex (so "debug" ≠ "bug").

## Recent changes
- 2026-06-08: New `reviewer-loop/` sub-tool — a self-improving loop for the PR review bot (the `prompt:` rubric in `.github/workflows/claude-review.yml`). It mines our own misses + scans curated sources (`sources.md`) for review-technique ideas, tests each against a deliberately hard benchmark suite, and opens a PR only on a measured **Pareto improvement** (recall/precision/verdict-accuracy must not regress vs the current rubric as baseline, ≥1 must improve). `score.mjs` (`npm run review-loop:score`, `--selftest` + sample runs included) is the deterministic judge so the rubric never grades itself; `suite/<id>/{pr.diff,expected.json}` are the fixtures (seeded: a subtle append-only-migration-edit blocker, a service-role RLS-leak blocker, a clean copy-change precision guard); `candidates.ndjson` is the ideas log; `PLAYBOOK.md` is the staged procedure. Autonomy boundary: the loop opens PRs, Axel is the merge gate. Obeys the dir rules — no product-runtime/DB writes, no deps, `.mjs` + Node built-ins, fail-safe.
- 2026-06-03: Initial agent-analytics tooling — backfill miner, four-quadrant report, eval-case loop (validator + suite + 3 seed cases from real corrections), three adapted prompts, and the `agent-analytics` GitHub Action (weekly + per-merge issue upsert, no commits). Local Claude Code hooks are opt-in (`hook-emit.mjs` + a snippet in README) since hooks don't run on the web.
