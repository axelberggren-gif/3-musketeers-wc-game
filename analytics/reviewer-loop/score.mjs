// Reviewer-improvement loop — deterministic scorer (the STABLE judge).
//
// Compares a reviewer run (its verdict + inline findings over the benchmark
// suite) against the answer keys, and optionally against a baseline run, then
// reports recall / precision / verdict-accuracy and a Pareto gate verdict.
//
// This script — not the evolving review rubric — is what decides whether a
// candidate is an improvement. The rubric never grades itself: it produces
// findings (PLAYBOOK stage 4); this scores them against fixed ground truth.
//
//   node analytics/reviewer-loop/score.mjs --baseline runs/baseline.json
//   node analytics/reviewer-loop/score.mjs --baseline runs/baseline.json --candidate runs/candidate-x.json
//   node analytics/reviewer-loop/score.mjs --baseline ... --candidate ... --json
//   node analytics/reviewer-loop/score.mjs --selftest
//
// Exit codes: 0 = ran OK (and, when a candidate is given, the gate PASSED) ·
//   3 = gate FAILED (candidate is not a clean improvement) · 1 = usage / IO /
//   schema error. Fail-safe: nothing throws past main().

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUITE_DIR = join(HERE, "suite");

const args = process.argv.slice(2);
const getFlag = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes(name);
const resolvePath = (p) => (isAbsolute(p) ? p : resolve(HERE, p));

const LINE_WINDOW = Number(getFlag("--window", "6")); // ± lines a finding may drift from the planted span
const EPSILON = Number(getFlag("--epsilon", "1e-9")); // how much regression to tolerate on any axis

const VERDICTS = new Set(["request_changes", "approve"]);
const KINDS = new Set(["blocker", "clean"]);

// ---- validation (fail loud, but only from main's try/catch) ----------------

function validateExpected(v, name) {
  const p = [];
  if (typeof v !== "object" || v === null) return [`${name}/expected.json is not an object`];
  if (typeof v.fixture !== "string" || !v.fixture.trim()) p.push("fixture must be a non-empty string");
  if (!KINDS.has(v.kind)) p.push(`kind must be one of: ${[...KINDS].join(", ")}`);
  if (!VERDICTS.has(v.expected_verdict)) p.push(`expected_verdict must be one of: ${[...VERDICTS].join(", ")}`);
  if (!Array.isArray(v.issues)) p.push("issues must be an array");
  else
    v.issues.forEach((it, i) => {
      if (typeof it.id !== "string" || !it.id.trim()) p.push(`issues[${i}].id must be a non-empty string`);
      if (typeof it.file !== "string" || !it.file.trim()) p.push(`issues[${i}].file must be a non-empty string`);
      if (!Array.isArray(it.lines) || it.lines.length !== 2 || it.lines.some((n) => typeof n !== "number"))
        p.push(`issues[${i}].lines must be [start, end] numbers`);
      if (!Array.isArray(it.match) || it.match.length === 0 || it.match.some((m) => typeof m !== "string"))
        p.push(`issues[${i}].match must be a non-empty string[] of regexes`);
    });
  if (v.kind === "clean" && Array.isArray(v.issues) && v.issues.length > 0)
    p.push("clean fixtures must have an empty issues array");
  return p;
}

function validateRun(v, label) {
  const p = [];
  if (typeof v !== "object" || v === null) return [`${label} is not an object`];
  if (typeof v.label !== "string" || !v.label.trim()) p.push("label must be a non-empty string");
  if (typeof v.results !== "object" || v.results === null) p.push("results must be an object keyed by fixture id");
  return p;
}

// ---- loading ---------------------------------------------------------------

function loadSuite() {
  if (!existsSync(SUITE_DIR)) throw new Error(`No suite directory at ${SUITE_DIR}`);
  const fixtures = [];
  for (const name of readdirSync(SUITE_DIR)) {
    const dir = join(SUITE_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const ef = join(dir, "expected.json");
    if (!existsSync(ef)) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(ef, "utf8"));
    } catch (e) {
      throw new Error(`Cannot parse ${name}/expected.json: ${e.message}`);
    }
    const problems = validateExpected(data, name);
    if (problems.length) throw new Error(`Invalid ${name}/expected.json:\n  - ${problems.join("\n  - ")}`);
    fixtures.push(data);
  }
  if (!fixtures.length) throw new Error(`No fixtures with an expected.json under ${SUITE_DIR}`);
  fixtures.sort((a, b) => a.fixture.localeCompare(b.fixture));
  return fixtures;
}

function loadRun(flagPath) {
  const path = resolvePath(flagPath);
  if (!existsSync(path)) throw new Error(`Run file not found: ${path}`);
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Cannot parse run file ${path}: ${e.message}`);
  }
  const problems = validateRun(data, flagPath);
  if (problems.length) throw new Error(`Invalid run file ${flagPath}:\n  - ${problems.join("\n  - ")}`);
  return data;
}

// ---- matching + scoring ----------------------------------------------------

function findingMatchesIssue(finding, issue) {
  if (finding.file !== issue.file) return false;
  if (typeof finding.line === "number") {
    const [lo, hi] = issue.lines;
    if (finding.line < lo - LINE_WINDOW || finding.line > hi + LINE_WINDOW) return false;
  }
  const text = String(finding.text || "");
  return issue.match.some((re) => {
    try {
      return new RegExp(re, "i").test(text);
    } catch {
      return false; // a malformed regex never matches rather than crashing the run
    }
  });
}

function scoreRun(run, fixtures) {
  let expectedTotal = 0;
  let matchedIssues = 0; // recall numerator (blocker fixtures)
  let findingsTotal = 0; // precision denominator (all fixtures)
  let truePositives = 0; // precision numerator
  let verdictCorrect = 0;
  const perFixture = [];

  for (const fx of fixtures) {
    const res = run.results[fx.fixture] || { verdict: "missing", findings: [] };
    const findings = Array.isArray(res.findings) ? res.findings : [];
    const used = new Set();
    let fxMatched = 0;

    for (const issue of fx.issues) {
      expectedTotal += 1;
      const idx = findings.findIndex((f, i) => !used.has(i) && findingMatchesIssue(f, issue));
      if (idx >= 0) {
        used.add(idx);
        matchedIssues += 1;
        fxMatched += 1;
      }
    }

    findingsTotal += findings.length;
    truePositives += used.size;
    const verdictOk = res.verdict === fx.expected_verdict;
    if (verdictOk) verdictCorrect += 1;

    perFixture.push({
      fixture: fx.fixture,
      kind: fx.kind,
      expectedIssues: fx.issues.length,
      matchedIssues: fxMatched,
      findings: findings.length,
      falsePositives: findings.length - used.size,
      expectedVerdict: fx.expected_verdict,
      actualVerdict: res.verdict ?? "missing",
      verdictOk,
    });
  }

  return {
    label: run.label,
    fixtures: fixtures.length,
    expectedTotal,
    matchedIssues,
    findingsTotal,
    truePositives,
    falsePositives: findingsTotal - truePositives,
    verdictCorrect,
    recall: expectedTotal ? matchedIssues / expectedTotal : 1,
    precision: findingsTotal ? truePositives / findingsTotal : 1,
    verdictAccuracy: fixtures.length ? verdictCorrect / fixtures.length : 1,
    perFixture,
  };
}

function gate(base, cand) {
  const dRecall = cand.recall - base.recall;
  const dPrecision = cand.precision - base.precision;
  const dVerdict = cand.verdictAccuracy - base.verdictAccuracy;
  const noRegression = dRecall >= -EPSILON && dPrecision >= -EPSILON && dVerdict >= -EPSILON;
  const improves = dRecall > EPSILON || dPrecision > EPSILON || dVerdict > EPSILON;
  return { pass: noRegression && improves, noRegression, improves, dRecall, dPrecision, dVerdict };
}

// ---- rendering -------------------------------------------------------------

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const signed = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pts`;

function renderMarkdown({ base, cand, g }) {
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`# Reviewer-loop eval — ${cand ? "candidate vs baseline" : "baseline"}`);
  p();
  p(`- Suite: ${base.fixtures} fixtures · ${base.expectedTotal} planted blockers`);
  p(`- Match window: ±${LINE_WINDOW} lines · gate epsilon: ${EPSILON}`);
  p(`- Judge: deterministic (this script). The rubric under test never grades itself.`);
  p();
  p(`| Run | Recall | Precision | Verdict acc. | False positives |`);
  p(`| --- | ---: | ---: | ---: | ---: |`);
  p(`| ${base.label} | ${pct(base.recall)} | ${pct(base.precision)} | ${pct(base.verdictAccuracy)} | ${base.falsePositives} |`);
  if (cand) {
    p(`| ${cand.label} | ${pct(cand.recall)} | ${pct(cand.precision)} | ${pct(cand.verdictAccuracy)} | ${cand.falsePositives} |`);
  }
  p();

  if (cand) {
    p(`## Gate: ${g.pass ? "✅ PASS — clean improvement" : "❌ FAIL — not a clean improvement"}`);
    p();
    p(`- Recall ${signed(g.dRecall)} · Precision ${signed(g.dPrecision)} · Verdict ${signed(g.dVerdict)}`);
    if (!g.noRegression) p(`- ✗ Regressed on at least one axis — reject (a noisier or weaker rubric).`);
    else if (!g.improves) p(`- ✗ No axis improved beyond epsilon — no reason to change the rubric.`);
    else p(`- ✓ No axis regressed and at least one improved — eligible to open a PR (PLAYBOOK stage 6).`);
    p();
  }

  const runs = cand ? [base, cand] : [base];
  p(`## Per-fixture`);
  for (const r of runs) {
    p();
    p(`### ${r.label}`);
    p(`| Fixture | Kind | Verdict | Blockers caught | False positives |`);
    p(`| --- | --- | --- | ---: | ---: |`);
    for (const f of r.perFixture) {
      const verdict = `${f.actualVerdict}${f.verdictOk ? " ✓" : ` ✗ (want ${f.expectedVerdict})`}`;
      const caught = f.kind === "blocker" ? `${f.matchedIssues}/${f.expectedIssues}` : "—";
      p(`| ${f.fixture} | ${f.kind} | ${verdict} | ${caught} | ${f.falsePositives} |`);
    }
  }
  p();
  return lines.join("\n") + "\n";
}

// ---- self-test (guards the scorer without pulling in a test runner) --------

function selftest() {
  const fixtures = [
    { fixture: "blk", kind: "blocker", expected_verdict: "request_changes", issues: [{ id: "x", file: "a.ts", lines: [10, 12], match: ["race"] }] },
    { fixture: "cln", kind: "clean", expected_verdict: "approve", issues: [] },
  ];
  const base = { label: "b", results: { blk: { verdict: "approve", findings: [] }, cln: { verdict: "approve", findings: [] } } };
  const cand = {
    label: "c",
    results: {
      blk: { verdict: "request_changes", findings: [{ file: "a.ts", line: 11, text: "possible RACE condition" }] },
      cln: { verdict: "approve", findings: [] },
    },
  };
  const b = scoreRun(base, fixtures);
  const c = scoreRun(cand, fixtures);
  const g = gate(b, c);
  const checks = [
    ["baseline recall 0", b.recall === 0],
    ["baseline precision 1 (no findings)", b.precision === 1],
    ["baseline verdict 50%", b.verdictAccuracy === 0.5],
    ["candidate recall 1 (line+regex within window)", c.recall === 1],
    ["candidate precision 1", c.precision === 1],
    ["candidate verdict 100%", c.verdictAccuracy === 1],
    ["gate passes on Pareto improvement", g.pass === true],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.error("SELFTEST FAILED:");
    for (const [name] of failed) console.error(`  - ${name}`);
    process.exit(1);
  }
  process.stdout.write("SELFTEST OK — 7 checks passed\n");
  process.exit(0);
}

// ---- main ------------------------------------------------------------------

function main() {
  if (has("--selftest")) return selftest();

  const baselineFlag = getFlag("--baseline");
  if (!baselineFlag) {
    console.error(
      "usage: node analytics/reviewer-loop/score.mjs --baseline <run.json> [--candidate <run.json>] [--json] [--window N] [--epsilon E]\n" +
        "       node analytics/reviewer-loop/score.mjs --selftest",
    );
    process.exit(1);
  }

  const fixtures = loadSuite();
  const base = scoreRun(loadRun(baselineFlag), fixtures);

  const candidateFlag = getFlag("--candidate");
  const cand = candidateFlag ? scoreRun(loadRun(candidateFlag), fixtures) : null;
  const g = cand ? gate(base, cand) : null;

  if (has("--json")) {
    process.stdout.write(JSON.stringify({ baseline: base, candidate: cand, gate: g }, null, 2) + "\n");
  } else {
    process.stdout.write(renderMarkdown({ base, cand, g }));
  }

  if (cand) process.exit(g.pass ? 0 : 3);
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error(`reviewer-loop scorer error: ${e.message}`);
  process.exit(1);
}
