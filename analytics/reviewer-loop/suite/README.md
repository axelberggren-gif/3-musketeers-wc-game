# suite/ — benchmark fixtures for the reviewer loop

Each fixture is a synthetic PR the review bot is scored on. One directory per
fixture, `NNNN-short-slug/`, containing exactly two files:

- **`pr.diff`** — what the reviewer reads: a `PR TITLE:` / `PR BODY:` header followed
  by a realistic unified diff. It does **not** need to apply to the tree; it's review
  material, so reference real repo paths and plausible line numbers.
- **`expected.json`** — the answer key.

## `expected.json`

```jsonc
{
  "fixture": "0001-points-bump-edits-existing-migration", // MUST equal the dir name
  "title": "Human-readable summary",
  "kind": "blocker",                  // "blocker" = should be caught · "clean" = must NOT be flagged
  "expected_verdict": "request_changes", // "request_changes" for blocker, "approve" for clean
  "issues": [                          // the planted blockers ([] for clean fixtures)
    {
      "id": "append-only-violation",
      "file": "supabase/migrations/0002_scoring.sql", // must equal the finding's file exactly
      "lines": [208, 214],             // [start, end]; a finding within ±window lines counts
      "category": "invariant",         // free-text tag (correctness | invariant | security | test | …)
      "severity": "critical",
      "match": ["append-only", "new .*migration"] // anyOf, case-insensitive regexes against finding text
    }
  ],
  "rationale": "Why this fixture exists and what makes it discriminating."
}
```

## How scoring uses it

A reviewer finding `{ file, line, text }` **matches** a planted issue when:
`finding.file === issue.file` **and** `line` is within `issue.lines ± window`
(default ±6; line check skipped if the finding omits a line) **and** at least one of
`issue.match` (case-insensitive regex) hits `finding.text`. Each issue is matched by
at most one finding and vice-versa.

- **recall** = matched planted issues ÷ total planted issues (blocker fixtures).
- **precision** = matched findings ÷ all findings (every fixture; on a clean fixture
  every finding is a false positive).
- **verdict accuracy** = fixtures whose verdict equals `expected_verdict`.

## Designing good fixtures

- **Make blockers hard.** The point is to discriminate. A blocker that any reviewer
  catches (like `0003`) anchors recall and stops silent regressions; the *hard* ones
  (`0001`: synced TS+SQL but an append-only edit) are where candidates earn promotion.
- **Always pair with a clean near-miss.** For every new rule, add a `clean` fixture
  that *looks* like it might trip the rule but shouldn't — that's what catches the
  rule over-firing. Without precision guards a candidate can't be fairly gated.
- **Write tight `match` regexes.** Loose ones ("error", "issue") match noise and
  inflate recall; anchor on the concept the reviewer must name (`append-only`,
  `supabaseService`, `idempotency`, `CRON_SECRET`).
- **Seed from reality.** `CODE_REVIEW.md` and closed `fix(...)`/`revert(...)` PRs are
  the best source — those are bugs that actually shipped past review.

## Current fixtures

| id | kind | tests |
| --- | --- | --- |
| `0001-points-bump-edits-existing-migration` | blocker (hard) | append-only migration edit, hidden behind a valid-looking points-sync change |
| `0002-countdown-copy-tweak` | clean | precision guard — pure copy/style must not be blocked |
| `0003-service-role-leak-in-user-route` | blocker | `supabaseService()` RLS bypass leaking picks in a user route |
