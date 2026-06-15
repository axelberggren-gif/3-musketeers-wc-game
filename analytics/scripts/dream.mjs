// Prompt 4 — "Dream over the agent's memory." The analytics pipeline mines git/PR
// history into correction signal (the *transcript* half of a dream); this script adds
// the missing *consolidation* half. It reads the repo's actual agent-memory store —
// the `CLAUDE.md` canon corpus + `evals/cases/*.json` — alongside that mined signal and
// proposes a reorganized memory in three dream-shaped buckets: MERGE (duplicates),
// REPLACE (stale / contradicted), SURFACE (new insights not yet captured).
//
// Like a real dream, the inputs are NEVER modified: this only reads and prints a
// reviewable proposal to stdout. You adopt the parts you like (edit a CLAUDE.md, add an
// eval) or discard it. Two engines run in one pass (see `--engine`):
//   • heuristic   — deterministic candidates, no model, CI-safe (built-ins only)
//   • prompt      — a ready-to-run consolidation prompt (prompts/04) + the packed
//                   "dream packet" to paste into Claude / the API for a richer pass
//
//   node analytics/scripts/dream.mjs                       # both engines, from git history
//   node analytics/scripts/dream.mjs --from-file           # signal from events/log.ndjson
//   node analytics/scripts/dream.mjs --since 2026-05-01
//   node analytics/scripts/dream.mjs --focus scoring       # steer (a dream's `instructions`)
//   node analytics/scripts/dream.mjs --engine heuristic    # one engine only (also: prompt)
//   node analytics/scripts/dream.mjs --inline              # embed memory file bodies in the bundle
//   node analytics/scripts/dream.mjs --min-cluster 3       # corrections needed to count as recurring

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEvents } from "../lib/collect.mjs";
import { EVENT_NAMES } from "../schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const analyticsDir = join(here, "..");
const repoRoot = join(analyticsDir, "..");

const args = process.argv.slice(2);
const getFlag = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

const since = getFlag("--since");
const focus = getFlag("--focus"); // a dream's `instructions` analog: an area / theme to bias toward
const engine = getFlag("--engine", "both"); // both | heuristic | prompt
const inline = args.includes("--inline");
const fromFile = args.includes("--from-file");
const minCluster = Math.max(2, Number(getFlag("--min-cluster", "2")));

const runHeuristic = engine === "both" || engine === "heuristic";
const runPrompt = engine === "both" || engine === "prompt";

// ── Load the "transcript" signal (mined correction events) ────────────────────────────
let events;
let meta;
if (fromFile) {
  const file = join(analyticsDir, "events", "log.ndjson");
  if (!existsSync(file)) {
    console.error(`No event log at ${file}. Run: npm run agent:backfill`);
    process.exit(1);
  }
  events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  meta = { fromFile: true, githubEnriched: false };
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

const matchesFocus = (s) => !focus || (s || "").toLowerCase().includes(focus.toLowerCase());

const corrections = events
  .filter((e) => e.event === EVENT_NAMES.USER_CORRECTION_SUBMITTED)
  .filter((e) => matchesFocus(e.workflow_type) || matchesFocus(e.description));

// ── Load the "memory store" (the agent-facing canon + the eval suite) ─────────────────
const STOPWORDS = new Set(
  ("the a an and or of to in on for with without is are was were be been do does not no never " +
    "this that it its at as by from into via per so if then than when while only also new add " +
    "use used uses change changed fix fixed pick picks match matches now still always must should")
    .split(" "),
);
const tokenize = (s) =>
  new Set(
    (s || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
  );
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
};

/** Recursively collect every CLAUDE.md (skipping vendored / build dirs). */
function findClaudeMds(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".next") continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) findClaudeMds(full, acc);
    else if (ent.name === "CLAUDE.md") acc.push(full);
  }
  return acc;
}

const claudeMdPaths = findClaudeMds(repoRoot);
const memoryFiles = claudeMdPaths.map((p) => {
  const text = readFileSync(p, "utf8");
  // The canon caps "Recent changes" at ~10 — overflow is a built-in staleness signal.
  const recentIdx = text.search(/^##\s+Recent changes/im);
  let recentCount = 0;
  if (recentIdx >= 0) {
    recentCount = (text.slice(recentIdx).match(/^- /gm) || []).length;
  }
  return { path: p, rel: relative(repoRoot, p), lines: text.split("\n").length, recentCount, text };
});

const caseDir = join(analyticsDir, "evals", "cases");
let evalCases = [];
if (existsSync(caseDir)) {
  evalCases = readdirSync(caseDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return { file: f, ...JSON.parse(readFileSync(join(caseDir, f), "utf8")) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
const evalWorkflows = new Set(evalCases.map((c) => c.workflow_type));

// ── Heuristic consolidation: MERGE / REPLACE / SURFACE ────────────────────────────────
function heuristicBuckets() {
  // Group corrections by workflow.
  const byWorkflow = new Map();
  for (const c of corrections) {
    const w = byWorkflow.get(c.workflow_type) || { count: 0, critical: 0, reverts: 0, reviewDriven: 0, samples: [] };
    w.count += 1;
    if (c.severity === "critical") w.critical += 1;
    if (/revert/i.test(c.description || "") || c.correction_type === "task_reopened") w.reverts += 1;
    if (c.review_driven) w.reviewDriven += 1;
    if (w.samples.length < 3 && c.description) w.samples.push(c.description);
    byWorkflow.set(c.workflow_type, w);
  }

  // SURFACE — recurring corrections in a workflow with no eval coverage yet.
  const surface = [];
  for (const [w, s] of byWorkflow) {
    if (s.count >= minCluster && !evalWorkflows.has(w)) {
      surface.push({
        workflow: w,
        count: s.count,
        why: `${s.count} corrections, ${s.reviewDriven} review-driven, ${s.critical} critical — no eval case covers \`${w}\` yet`,
        action: `Capture the recurring failure as an invariant in the relevant CLAUDE.md and an eval case (npm run agent:evals).`,
        samples: s.samples,
      });
    }
  }
  surface.sort((a, b) => b.count - a.count);

  // REPLACE — candidate stale / contradicted memory.
  const replace = [];
  for (const [w, s] of byWorkflow) {
    if ((s.reverts > 0 || s.critical > 0) && evalWorkflows.has(w)) {
      replace.push({
        what: `eval + CLAUDE.md guidance for \`${w}\``,
        why: `${s.reverts} revert(s) / ${s.critical} critical correction(s) landed on a covered workflow — the existing guidance may now be stale or contradicted.`,
        action: `Re-read the \`${w}\` CLAUDE.md invariants + eval cases against the latest reverted/corrected behaviour; replace whatever no longer matches reality.`,
      });
    }
  }
  for (const m of memoryFiles) {
    if (m.recentCount > 10 && matchesFocus(m.rel)) {
      replace.push({
        what: `${m.rel} → "Recent changes"`,
        why: `${m.recentCount} entries — the canon caps this list at ~10. Older entries are stale historical record, not current behaviour.`,
        action: `Trim "Recent changes" to the last ~10; fold any still-true guidance up into the body / invariants.`,
      });
    }
  }

  // MERGE — eval cases that look like duplicates (same workflow, high text overlap).
  const merge = [];
  for (let i = 0; i < evalCases.length; i += 1) {
    for (let j = i + 1; j < evalCases.length; j += 1) {
      const a = evalCases[i];
      const b = evalCases[j];
      if (a.workflow_type !== b.workflow_type) continue;
      if (!matchesFocus(a.workflow_type)) continue;
      const sim = jaccard(
        tokenize(`${a.scenario} ${a.expected_behavior} ${a.assertion}`),
        tokenize(`${b.scenario} ${b.expected_behavior} ${b.assertion}`),
      );
      if (sim >= 0.4) {
        merge.push({
          pair: [a.eval_id, b.eval_id],
          similarity: Math.round(sim * 100),
          action: `Likely the same lesson in two cases — merge into one canonical eval and drop the weaker.`,
        });
      }
    }
  }
  merge.sort((a, b) => b.similarity - a.similarity);

  return { surface, replace, merge };
}

// ── Output ────────────────────────────────────────────────────────────────────────────
const lines = [];
const p = (s = "") => lines.push(s);

p(`# Agent-memory dream — consolidation proposal`);
p();
p(`> A dream reads a memory store + past transcripts and proposes a reorganized memory: duplicates merged, stale entries replaced, new insights surfaced. **This is read-only** — adopt the parts you like (edit a CLAUDE.md, add an eval) or discard it. Nothing here is modified.`);
p();
p(`- Window: ${since ? `since ${since}` : "full history"}`);
p(`- Transcript signal: ${meta.fromFile ? "committed event log" : "git first-parent history"}${meta.githubEnriched ? " + GitHub API" : " (git-only)"} → ${corrections.length} correction(s)${focus ? `, focus = \`${focus}\`` : ""}`);
p(`- Memory store: ${memoryFiles.length} CLAUDE.md file(s) + ${evalCases.length} eval case(s)`);
p(`- Engine: ${engine}`);
if (!meta.githubEnriched && !meta.fromFile) {
  p(`- ⚠ git-only: review CHANGES_REQUESTED corrections are absent. Run in CI / with \`gh\` for the full correction signal.`);
}

if (runHeuristic) {
  const { surface, replace, merge } = heuristicBuckets();
  p();
  p(`## Heuristic candidates (deterministic)`);

  p();
  p(`### 🔆 Surface — recurring corrections not yet captured`);
  if (!surface.length) p(`_None: no workflow has ≥${minCluster} uncaptured corrections in this window._`);
  for (const s of surface) {
    p(`- **\`${s.workflow}\`** — ${s.why}`);
    p(`  - → ${s.action}`);
    for (const ex of s.samples) p(`  - e.g. "${ex.slice(0, 160)}"`);
  }

  p();
  p(`### ♻️ Replace — candidate stale / contradicted memory`);
  if (!replace.length) p(`_None flagged._`);
  for (const r of replace) {
    p(`- **${r.what}** — ${r.why}`);
    p(`  - → ${r.action}`);
  }

  p();
  p(`### 🔗 Merge — likely-duplicate eval cases`);
  if (!merge.length) p(`_None: no same-workflow eval pair exceeds the similarity floor._`);
  for (const m of merge) p(`- ${m.pair[0]} ⇄ ${m.pair[1]} (~${m.similarity}% overlap) — ${m.action}`);
}

if (runPrompt) {
  p();
  p(`## Model pass — ready-to-run dream prompt`);
  const promptPath = join(analyticsDir, "prompts", "04-dream-consolidate.md");
  let promptBody = "";
  if (existsSync(promptPath)) {
    const md = readFileSync(promptPath, "utf8");
    const m = md.match(/```prompt\n([\s\S]*?)\n```/);
    promptBody = m ? m[1] : md;
  } else {
    promptBody = "(analytics/prompts/04-dream-consolidate.md missing — see it for the role/instructions.)";
  }
  p();
  p("Paste everything in the fenced block below into Claude (or send it via the API with the focus as `instructions`). It bundles the prompt with the packed **dream packet** — the memory manifest, the correction signal, and the heuristic candidates above for the model to refine.");
  p();
  p("````text");
  p(promptBody.trim());
  p();
  p("=== DREAM PACKET ===");
  if (focus) p(`focus / instructions: ${focus}`);
  p();
  p("--- Memory store: CLAUDE.md corpus ---");
  for (const m of memoryFiles) {
    p(`- ${m.rel} (${m.lines} lines, ${m.recentCount} recent-changes entries)`);
  }
  p();
  p("--- Memory store: eval cases ---");
  for (const c of evalCases) p(`- ${c.eval_id} [${c.workflow_type}/${c.dimension}/${c.severity}]: ${c.expected_behavior}`);
  p();
  p("--- Transcript signal: corrections ---");
  if (!corrections.length) p("(none in window)");
  for (const c of corrections) {
    p(`- ${c.agent_run_id} [${c.workflow_type}] ${c.correction_type}/${c.severity}: ${(c.description || "").slice(0, 200)}`);
  }
  if (inline) {
    p();
    p("--- Memory store: full CLAUDE.md bodies (--inline) ---");
    for (const m of memoryFiles) {
      p();
      p(`>>> FILE ${m.rel}`);
      p(m.text.trim());
      p(`<<< END ${m.rel}`);
    }
  } else {
    p();
    p("(Run with --inline to embed full CLAUDE.md bodies; otherwise read the files listed above directly.)");
  }
  p("````");
}

p();
process.stdout.write(lines.join("\n") + "\n");
