// Schema + validator for eval cases produced by Prompt 02 (correction → eval).
// Pure, dependency-free, strict-TS clean so `tsc`/`next build` and the vitest
// suite all stay green. The committed cases in ./cases/*.json are checked against
// this by cases.test.ts.

export interface EvalCase {
  /** Descriptive slug, e.g. "football-data-group-letter-v4-format". */
  eval_id: string;
  /** Which production signal this case came from. */
  event_type: "user_correction_submitted" | "approval_denied" | "memory_miss" | "tool_call_failed";
  /** Which eval dimension this tests. */
  dimension: "quality" | "safety" | "retrieval" | "schema";
  /** Reproducible input conditions (redacted of any sensitive data). */
  scenario: string;
  /** What the agent actually did (the wrong/insufficient thing). */
  agent_behavior_observed: string;
  /** What the agent should have done instead. */
  expected_behavior: string;
  /** A testable predicate a reviewer or automated check can evaluate. */
  assertion: string;
  severity: "minor" | "major" | "critical";
  /** area:* label or conventional scope this belongs to. */
  workflow_type: string;
  notes?: string;
}

const EVENT_TYPES = ["user_correction_submitted", "approval_denied", "memory_miss", "tool_call_failed"] as const;
const DIMENSIONS = ["quality", "safety", "retrieval", "schema"] as const;
const SEVERITIES = ["minor", "major", "critical"] as const;
const REQUIRED_STRINGS = [
  "eval_id",
  "scenario",
  "agent_behavior_observed",
  "expected_behavior",
  "assertion",
  "workflow_type",
] as const;

/** Returns a list of problems; an empty array means `value` is a valid EvalCase. */
export function validateEvalCase(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) return ["value is not an object"];
  const v = value as Record<string, unknown>;

  for (const key of REQUIRED_STRINGS) {
    if (typeof v[key] !== "string" || (v[key] as string).trim() === "") {
      problems.push(`${key} must be a non-empty string`);
    }
  }
  if (!EVENT_TYPES.includes(v.event_type as (typeof EVENT_TYPES)[number])) {
    problems.push(`event_type must be one of: ${EVENT_TYPES.join(", ")}`);
  }
  if (!DIMENSIONS.includes(v.dimension as (typeof DIMENSIONS)[number])) {
    problems.push(`dimension must be one of: ${DIMENSIONS.join(", ")}`);
  }
  if (!SEVERITIES.includes(v.severity as (typeof SEVERITIES)[number])) {
    problems.push(`severity must be one of: ${SEVERITIES.join(", ")}`);
  }
  if ("notes" in v && v.notes !== undefined && typeof v.notes !== "string") {
    problems.push("notes must be a string when present");
  }
  return problems;
}
