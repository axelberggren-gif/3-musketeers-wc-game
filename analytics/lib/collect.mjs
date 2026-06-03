// Orchestration: walk first-parent history and emit normalized analytics events.
// This is the shared core behind both `backfill.mjs` and `report.mjs`, so the two
// always agree on what an "event" is.

import { readCommits, repoSlug, readChangelogAttribution, ghAvailable, ghApiJson, changedFiles } from "./sources.mjs";
import {
  parseConventional,
  parseMerge,
  isBranchSyncMerge,
  branchInitials,
  branchType,
  resolveWorkflowType,
  inferAreaFromSlug,
  areaFromFiles,
  decideCorrection,
} from "./classify.mjs";
import { agentRunStarted, taskCompleted, userCorrectionSubmitted } from "../schema.mjs";

/**
 * @param {{ since?: string|null, pr?: number|null, useGithub?: boolean }} [opts]
 * @returns {{ events: object[], meta: { accountId: string, totalRuns: number, githubEnriched: boolean, commitsScanned: number } }}
 */
export function collectEvents(opts = {}) {
  const accountId = repoSlug();
  const commits = readCommits({ since: opts.since });
  const changelog = readChangelogAttribution();
  const useGh = Boolean(opts.useGithub) && ghAvailable();

  const events = [];
  let totalRuns = 0;

  for (const c of commits) {
    if (isBranchSyncMerge(c.subject)) continue;

    const merge = parseMerge(c.subject);
    const conv = merge ? null : parseConventional(c.subject);
    // Neither a PR merge nor a conventional commit → not a classifiable run.
    if (!merge && !conv) continue;

    const prNumber = merge ? merge.prNumber : conv.prNumber;
    const slug = merge ? merge.branch : "";
    const agentRunId = prNumber ? `PR-${prNumber}` : `commit-${c.hash.slice(0, 7)}`;

    let type = null;
    let workflowType = "unknown";
    let initials = "unknown";
    let title = c.subject;

    if (conv) {
      type = conv.type;
      title = conv.title;
      workflowType = conv.scope ? resolveWorkflowType(conv.scope) : "unknown";
    } else {
      const bt = branchType(slug);
      type = bt && bt !== "claude" ? bt : null;
      const bi = branchInitials(slug);
      if (bi) initials = bi;
      title = `#${prNumber} ${slug}`;
    }

    // Most reliable area signal: the files the PR actually changed. Used whenever
    // an explicit conventional scope didn't already pin the workflow.
    if (workflowType === "unknown") {
      workflowType = areaFromFiles(changedFiles(c.hash)) || inferAreaFromSlug(slug) || "unknown";
    }

    // CHANGELOG fills initials the branch couldn't (squash commits) and flags reviews.
    const cl = prNumber ? changelog.get(prNumber) : null;
    if (initials === "unknown" && cl && cl.initials && cl.initials !== "?") initials = cl.initials;

    // Optional GitHub enrichment: true completion state + area label + bot verdict.
    let prState = null;
    let changesRequested = false;
    if (useGh && prNumber) {
      const pr = ghApiJson(`repos/${accountId}/pulls/${prNumber}`);
      if (pr) {
        prState = pr.merged_at ? "merged" : pr.state;
        const areaLabel = (pr.labels || []).map((l) => l.name).find((n) => n.startsWith("area:"));
        if (areaLabel) workflowType = areaLabel.slice("area:".length);
      }
      const reviews = ghApiJson(`repos/${accountId}/pulls/${prNumber}/reviews`);
      if (Array.isArray(reviews)) changesRequested = reviews.some((r) => r.state === "CHANGES_REQUESTED");
    }

    const base = { agentRunId, userId: initials, accountId, workflowType, timestamp: c.authorDate };
    const triggerSource = merge ? "merge" : "squash";

    events.push(agentRunStarted(base, { intentSummary: title.slice(0, 140), triggerSource }));

    const status = prState && prState !== "merged" ? "failed" : "completed";
    events.push(taskCompleted(base, { status }));

    const corr = decideCorrection({
      type,
      subject: c.subject,
      body: c.body,
      slug,
      changesRequested,
      changelogReview: Boolean(cl && cl.reviewMarker),
    });
    if (corr) events.push(userCorrectionSubmitted(base, corr));

    totalRuns += 1;
  }

  let out = events;
  if (opts.pr) out = out.filter((e) => e.agent_run_id === `PR-${opts.pr}`);
  out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  return { events: out, meta: { accountId, totalRuns, githubEnriched: useGh, commitsScanned: commits.length } };
}
