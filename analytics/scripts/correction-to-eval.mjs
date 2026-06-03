// Prompt 2 feeder — "Turn a correction into an eval case." Emits draft eval-case
// stubs (one per correction event) as JSON to stdout. A human/agent then completes
// the scenario / expected_behavior / assertion using analytics/prompts/02 and saves
// the finished case to analytics/evals/cases/<eval_id>.json (validated by the suite).
//
//   node analytics/scripts/correction-to-eval.mjs --since 2026-05-01 > drafts.json
//   node analytics/scripts/correction-to-eval.mjs --from-file --limit 10

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
const limit = Number(getFlag("--limit", "20"));
const fromFile = args.includes("--from-file");

let events;
if (fromFile) {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "events", "log.ndjson");
  if (!existsSync(file)) {
    console.error(`No event log at ${file}. Run: npm run agent:backfill`);
    process.exit(1);
  }
  events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
} else {
  ({ events } = collectEvents({ since, useGithub: !args.includes("--no-github") }));
}

// Map a correction_type to the eval dimension it most likely tests.
const DIMENSION_BY_CORRECTION = {
  task_reopened: "safety",
  plan_change: "safety",
  tool_override: "schema",
  context_clarification: "retrieval",
  output_edit: "quality",
};

const stubs = events
  .filter((e) => e.event === EVENT_NAMES.USER_CORRECTION_SUBMITTED)
  .slice(0, limit)
  .map((e) => ({
    eval_id: `${e.workflow_type}-${e.agent_run_id}-${e.correction_type}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    event_type: "user_correction_submitted",
    dimension: DIMENSION_BY_CORRECTION[e.correction_type] || "quality",
    scenario: `TODO: describe the input conditions for ${e.agent_run_id} in ${e.workflow_type}.`,
    agent_behavior_observed: e.description || "TODO",
    expected_behavior: "TODO: what the agent should have done instead.",
    assertion: "TODO: a single testable predicate (see analytics/prompts/02-correction-to-eval.md).",
    severity: e.severity,
    workflow_type: e.workflow_type,
    notes: `Auto-stub from a correction event at ${e.timestamp} (review_driven=${e.review_driven}).`,
  }));

process.stdout.write(JSON.stringify(stubs, null, 2) + "\n");
console.error(
  `\n${stubs.length} draft eval stub(s) emitted. Complete them with ` +
    `analytics/prompts/02-correction-to-eval.md, then save each finished case to ` +
    `analytics/evals/cases/<eval_id>.json (cases.test.ts validates them).`,
);
