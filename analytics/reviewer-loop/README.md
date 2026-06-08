# reviewer-loop — self-improving PR review bot

A propose → prove → open-a-PR loop that improves **the PR review bot** (the
`prompt:` rubric in `.github/workflows/claude-review.yml`). It scans for new review
ideas and mines our own misses, tests each idea against a deliberately hard
benchmark suite, and **only opens a PR when the change measurably beats the current
rubric without getting noisier**. A human (Axel) is the merge gate.

The operational procedure is [`PLAYBOOK.md`](./PLAYBOOK.md). This file explains the
pieces.

## Why it's built this way

A reviewer that flags everything "catches every bug" and is useless. So the loop
measures two axes on every candidate, over a *suite* (not one PR):

- **recall** — did it catch the planted blockers?
- **precision** — did it avoid false positives? (guarded by clean fixtures)
- **verdict accuracy** — did it land on the right `approve` / `request_changes`?

A candidate is promoted to a PR only on a **Pareto improvement**: no axis regresses
and at least one improves, against the current rubric as **baseline**. The judge is
`score.mjs` — deterministic and fixed — so the evolving rubric never grades itself.
This is the same discipline as the repo's points-sync invariant: the thing under
test and the thing that checks it are kept separate.

## Layout

```
reviewer-loop/
  PLAYBOOK.md          # the loop, stage by stage (the deliverable)
  README.md            # this file
  score.mjs            # deterministic judge: findings vs answer keys → recall/precision/gate
  sources.md           # curated, low-noise sources for the monthly news leg
  candidates.ndjson    # the ideas log — every candidate + its scores + status
  suite/               # benchmark fixtures (pr.diff + expected.json answer key)
  runs/                # reviewer findings over the suite (baseline + per-candidate)
```

## Commands

```bash
npm run review-loop:score -- --selftest                              # sanity-check the judge
npm run review-loop:score -- --baseline runs/baseline.json           # absolute scores for one run
npm run review-loop:score -- --baseline runs/baseline.json --candidate runs/candidate-x.json
npm run review-loop:score -- --baseline ... --candidate ... --json   # machine-readable (loop reads .gate.pass)
```

Flags: `--window N` (±lines a finding may drift from the planted span, default 6),
`--epsilon E` (regression tolerance per axis, default 1e-9). Exit codes: `0` ran OK
(and gate PASSED when a candidate is given) · `3` gate FAILED · `1` usage/IO/schema
error. Try it now against the committed samples:

```bash
npm run review-loop:score -- --baseline runs/baseline.sample.json --candidate runs/candidate.sample.json
```

> The `runs/*.sample.json` files are **illustrative** so the command runs out of the
> box. Real runs (Stage 4) replace them; never gate against the samples.

## File schemas

**`suite/<id>/expected.json`** — the answer key (see `suite/README.md` for the full
spec). `kind: "blocker"` fixtures plant `issues` (each with `file`, `lines:[start,end]`,
and `match` regexes); `kind: "clean"` fixtures have `issues: []` so any finding is a
false positive.

**`runs/<label>.json`** — what a reviewer said over the suite:

```jsonc
{
  "label": "candidate-flag-existing-migration-edits",
  "rubric_ref": ".github/workflows/claude-review.yml@candidate",
  "results": {
    "<fixture-id>": {
      "verdict": "request_changes",          // or "approve"
      "findings": [{ "file": "…", "line": 211, "text": "…" }]
    }
  }
}
```

**`candidates.ndjson`** — append-only ideas log, one JSON object per line:

```jsonc
{
  "id": "flag-existing-migration-edits",
  "created_at": "2026-06-08",
  "source": { "kind": "correction", "ref": "CODE_REVIEW.md#append-only / migrations/CLAUDE.md" },
  "target": ".github/workflows/claude-review.yml prompt block",
  "summary": "Block edits to already-merged migration files, even when points stay in sync.",
  "hypothesis": "Catches the 0001 class (synced TS+SQL but append-only violated) without new false positives.",
  "fixtures": ["0001-points-bump-edits-existing-migration"],
  "status": "proposed",          // proposed → tested → pr-open → approved | rejected
  "scores": null,                 // filled at Stage 5: { baseline, candidate, gate }
  "pr": null,
  "decision_note": ""
}
```

## Putting it on a cadence

- **`/loop` skill:** `/loop 1w <PLAYBOOK as a prompt>` for the weekly corrections leg;
  a monthly run for the news leg.
- **PR-activity subscription:** trigger the corrections leg when a `fix`/`revert` PR
  merges.
- **Optional scheduled GitHub Action** (not wired by default — it spends the review
  bot's subscription): a `schedule:`-triggered job that runs `anthropics/claude-code-action`
  with `PLAYBOOK.md` as the prompt and the `mcp__github__*` PR-write tools allowed, so
  it can open the PR itself. Add it only if you want hands-off cadence; the human merge
  gate still applies.

## Boundaries

This lives in `analytics/` and obeys the dir's rules: **no product-runtime or DB
changes, no new dependencies, `.mjs` + Node built-ins, fail-safe.** The loop's only
write targets are the reviewer rubric, this `suite/`, and `candidates.ndjson`. It
opens PRs; it never merges.
