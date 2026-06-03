// Agent-analytics event schema — the single source of truth for the event shapes
// emitted by the backfill miner and (in CI) the live GitHub Action.
//
// Context: this repo is built by AI coding agents. We instrument *their* work,
// mapping the prompt-kit's product-analytics events onto dev-agent activity:
//   agent_run_id   → a GitHub PR (the durable unit of delegated work)
//   workflow_type  → the area:* label / conventional-commit scope
//   user_id        → human initials from the branch / CHANGELOG attribution
// See analytics/CLAUDE.md and analytics/prompts/01-instrument.md.

/** The full ten-event catalog (3 starter + 7 roadmap). */
export const EVENT_NAMES = Object.freeze({
  AGENT_RUN_STARTED: "agent_run_started",
  TASK_COMPLETED: "task_completed",
  USER_CORRECTION_SUBMITTED: "user_correction_submitted",
  // roadmap — emitted opportunistically as the signal becomes available:
  TOOL_CALL_FAILED: "tool_call_failed",
  APPROVAL_DENIED: "approval_denied",
  PERMISSION_BLOCKED: "permission_blocked",
  MEMORY_MISS: "memory_miss",
  ESCALATION_TRIGGERED: "escalation_triggered",
  TASK_ABANDONED: "task_abandoned",
  BUSINESS_OUTCOME_RECORDED: "business_outcome_recorded",
});

export const CORRECTION_TYPES = Object.freeze([
  "output_edit",
  "plan_change",
  "tool_override",
  "context_clarification",
  "task_reopened",
]);

export const SEVERITIES = Object.freeze(["minor", "major", "critical"]);

export const TASK_STATUSES = Object.freeze(["completed", "partial", "failed"]);

/**
 * Canonical area:* labels (from .github/labels.yml). workflow_type prefers one of
 * these; finer conventional-commit scopes (auth, banter, social…) pass through.
 */
export const AREAS = Object.freeze([
  "scoring",
  "predict",
  "admin",
  "supabase",
  "football-data",
  "infra",
  "ui",
]);

/**
 * @typedef {Object} BaseFields
 * @property {string} agentRunId    "PR-<n>" or "commit-<sha7>" when no PR exists.
 * @property {string} userId        Human initials, or "unknown".
 * @property {string} accountId     "<owner>/<repo>".
 * @property {string} workflowType  area:* label or conventional scope.
 * @property {string} timestamp     ISO 8601.
 * @property {string|null} [traceId] Reserved — links to an engineering trace.
 */

/** Build the base fields shared by every event. */
export function baseEvent({ event, agentRunId, userId, accountId, workflowType, timestamp, traceId = null }) {
  return {
    event,
    agent_run_id: agentRunId,
    user_id: userId || "unknown",
    account_id: accountId,
    workflow_type: workflowType || "unknown",
    timestamp,
    trace_id: traceId,
  };
}

/** Fires when a task is delegated (PR opened / first agent commit on a branch). */
export function agentRunStarted(base, { intentSummary, triggerSource }) {
  return {
    ...baseEvent({ ...base, event: EVENT_NAMES.AGENT_RUN_STARTED }),
    intent_summary: intentSummary,
    trigger_source: triggerSource,
  };
}

/** Fires when a run reaches a terminal state (PR merged / closed). */
export function taskCompleted(base, { status, durationMs = null, toolCallsTotal = null, toolCallsFailed = null, outputSummary = null }) {
  return {
    ...baseEvent({ ...base, event: EVENT_NAMES.TASK_COMPLETED }),
    status,
    duration_ms: durationMs,
    tool_calls_total: toolCallsTotal,
    tool_calls_failed: toolCallsFailed,
    output_summary: outputSummary,
  };
}

/** Fires when prior agent work is corrected (review change, post-merge fix, revert). */
export function userCorrectionSubmitted(base, { correctionType, targetTool = null, severity, description, reviewDriven = false }) {
  return {
    ...baseEvent({ ...base, event: EVENT_NAMES.USER_CORRECTION_SUBMITTED }),
    correction_type: correctionType,
    target_tool: targetTool,
    severity,
    description,
    review_driven: reviewDriven,
  };
}
