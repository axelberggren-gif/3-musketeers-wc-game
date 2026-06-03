// Prompt 3 — "Read my completion-vs-acceptance numbers." Reduces events to
// per-workflow completion + correction rates and prints the four-quadrant
// diagnosis as Markdown (readable in a terminal and usable as a GitHub issue body).
//
//   node analytics/scripts/report.mjs                    # fresh, from git history
//   node analytics/scripts/report.mjs --from-file        # from committed events/log.ndjson
//   node analytics/scripts/report.mjs --since 2026-05-01
//   node analytics/scripts/report.mjs --completion-threshold 70 --acceptance-threshold 75

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEvents } from "../lib/collect.mjs";
import { EVENT_NAMES } from "../schema.mjs";

const args = process.argv.slice(2);
const getFlag = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

const since = getFlag("--since");
const fromFile = args.includes("--from-file");
const completionHigh = Number(getFlag("--completion-threshold", "70"));
const acceptanceHigh = Number(getFlag("--acceptance-threshold", "75"));
const correctionHigh = 100 - acceptanceHigh;

let events;
let meta;
if (fromFile) {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "events", "log.ndjson");
  if (!existsSync(file)) {
    console.error(`No event log at ${file}. Run: npm run agent:backfill`);
    process.exit(1);
  }
  events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  meta = { githubEnriched: false, fromFile: true };
} else {
  ({ events, meta } = collectEvents({ since, useGithub: !args.includes("--no-github") }));
}

// Dedupe identical event lines (append-mode logs can repeat the same row).
{
  const seen = new Set();
  events = events.filter((e) => {
    const k = JSON.stringify(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// events → per-run → per-workflow aggregates.
const runs = new Map();
for (const e of events) {
  const r = runs.get(e.agent_run_id) || { area: e.workflow_type, status: "completed", corrections: 0, critical: false };
  r.area = e.workflow_type;
  if (e.event === EVENT_NAMES.TASK_COMPLETED) r.status = e.status;
  if (e.event === EVENT_NAMES.USER_CORRECTION_SUBMITTED) {
    r.corrections += 1;
    if (e.severity === "critical") r.critical = true;
  }
  runs.set(e.agent_run_id, r);
}

const areas = new Map();
for (const r of runs.values()) {
  const a = areas.get(r.area) || { runs: 0, completed: 0, corrected: 0, critical: 0 };
  a.runs += 1;
  if (r.status === "completed") a.completed += 1;
  if (r.corrections > 0) a.corrected += 1;
  if (r.critical) a.critical += 1;
  areas.set(r.area, a);
}

const QUAD = {
  Q1: "Q1 · trusted (ship-ready)",
  Q2: "Q2 · finishing work nobody trusts ⚠",
  Q3: "Q3 · failing before review",
  Q4: "Q4 · too cautious but valuable",
};
const PRIORITY = { Q2: 0, Q3: 1, Q4: 2, Q1: 3 };

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function classify(completionPct, correctionPct) {
  const highComplete = completionPct >= completionHigh;
  const lowCorrection = correctionPct <= correctionHigh;
  if (highComplete && lowCorrection) return "Q1";
  if (highComplete && !lowCorrection) return "Q2";
  if (!highComplete && !lowCorrection) return "Q3";
  return "Q4";
}

function diagnosis(r) {
  switch (r.q) {
    case "Q2":
      return `${r.corrected}/${r.runs} runs needed a correction (${r.correctionPct}%)${r.critical ? `, ${r.critical} critical` : ""}. Dashboards call this healthy — it isn't. Tighten output quality / context here before adding autonomy, and mine these corrections into evals.`;
    case "Q3":
      return `Low completion *and* high correction — structural. Audit the tooling / permissions / context for this workflow before trusting agents with it.`;
    case "Q4":
      return `When it finishes it's accepted, but it finishes too rarely. Likely over-gated or under-tooled — reduce friction.`;
    default:
      return `Agents ship clean here (${r.correctionPct}% correction across ${plural(r.runs, "run")}). Candidate for more autonomy / fewer gates; watch for regressions.`;
  }
}

const rows = [];
for (const [area, a] of areas) {
  const completionPct = a.runs ? Math.round((a.completed / a.runs) * 100) : 0;
  const correctionPct = a.runs ? Math.round((a.corrected / a.runs) * 100) : 0;
  rows.push({ area, ...a, completionPct, correctionPct, q: classify(completionPct, correctionPct) });
}
rows.sort((x, y) => PRIORITY[x.q] - PRIORITY[y.q] || y.corrected - x.corrected || y.runs - x.runs);

const lines = [];
const p = (s = "") => lines.push(s);

p(`# Agent Product Analytics — four-quadrant report`);
p();
p(`- Window: ${since ? `since ${since}` : "full history"}`);
p(`- Source: ${meta.fromFile ? "committed event log" : "git first-parent history"}${meta.githubEnriched ? " + GitHub API" : " (git-only)"}`);
p(`- Runs (PRs): ${runs.size} across ${areas.size} workflows`);
p(`- Thresholds: completion ≥ ${completionHigh}% = high · acceptance ≥ ${acceptanceHigh}% (correction ≤ ${correctionHigh}%) = high`);
if (!meta.githubEnriched) {
  p(`- ⚠ Completion is git-only: closed/abandoned PRs never land on mainline, so completion ≈ 100% and the **correction rate is the load-bearing axis**. Run with GitHub enrichment (in CI, or with \`gh\` present) for true completion + the bot's CHANGES_REQUESTED signal.`);
}
p();
p(`| Workflow | Runs | Completion | Correction | Critical | Quadrant |`);
p(`| --- | ---: | ---: | ---: | ---: | --- |`);
for (const r of rows) p(`| ${r.area} | ${r.runs} | ${r.completionPct}% | ${r.correctionPct}% | ${r.critical} | ${QUAD[r.q]} |`);
p();
p(`## Priority order & next move`);
for (const r of rows) {
  p();
  p(`### ${r.area} — ${QUAD[r.q]}`);
  p(diagnosis(r));
}
p();
p(`## What to measure next`);
if (!meta.githubEnriched) {
  p(`- Enrich with GitHub (CI / \`gh\`) to add true completion + the review bot's \`approval_denied\` signal — that's what separates Q3/Q4 from Q1/Q2.`);
}
const unknown = areas.get("unknown");
if (unknown) {
  p(`- ${plural(unknown.runs, "run")} classified as \`unknown\` — add \`area:*\` labels or commit scopes so they classify.`);
}
p(`- Add \`business_outcome_recorded\` (merge → Vercel prod deploy / linked issue closed) to tie shipped agent work to outcomes.`);
p(`- Run \`npm run agent:evals\` + \`analytics/prompts/02-correction-to-eval.md\` to turn the corrections above into regression tests.`);

process.stdout.write(lines.join("\n") + "\n");
