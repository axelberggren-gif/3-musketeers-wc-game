// Parsing + heuristics: turn a raw commit/PR landing into (workflow_type, initials,
// correction?). High precision over recall — we'd rather miss a correction than
// invent one. Tune the keyword maps as the team's conventions evolve.

import { AREAS } from "../schema.mjs";

const CONVENTIONAL_TYPES = new Set([
  "feat", "fix", "chore", "docs", "refactor", "perf", "ci", "revert", "test", "build", "style",
]);

// Conventional-commit scope → canonical area:* label (when they differ).
const SCOPE_TO_AREA = {
  bracket: "predict",
  db: "supabase",
  rls: "supabase",
  types: "supabase",
  migrations: "supabase",
  deps: "infra",
  ci: "infra",
  "claude-review": "infra",
};

// Merge-style PRs carry a branch slug (e.g. claude/league-rls-recursion-fix) but
// no conventional scope. These keywords map the slug to an area. Order matters —
// the first match wins.
const AREA_KEYWORDS = [
  ["supabase", /\b(rls|league|migration|supabase|citext|recursion|member|invite|redeem)\b/i],
  ["predict", /\b(predict|bracket|r32|dropdown|countdown|group-filter)\b/i],
  ["scoring", /\b(scoring|points|tiebreak)\b/i],
  ["football-data", /\b(football|fixture|scorer|group-letter)\b/i],
  ["ui", /\b(banter|sticker|design|social|reaction|chat|theme)\b/i],
  ["admin", /\b(admin|override)\b/i],
  ["infra", /\b(sentry|ci|claude-review|hook|infra|workflow|deps|login|callback)\b/i],
];

// Changed-file path → area. Most reliable signal: ordered most-specific first.
const PATH_RULES = [
  [/^lib\/scoring\//, "scoring"],
  [/^supabase\/migrations\//, "supabase"],
  [/^lib\/supabase\//, "supabase"],
  [/^lib\/football-data\//, "football-data"],
  [/^app\/api\/cron\//, "football-data"],
  [/^lib\/predictions\//, "predict"],
  [/^components\/predict\//, "predict"],
  [/^app\/\(app\)\/predict\//, "predict"],
  [/^lib\/auth\//, "auth"],
  [/^app\/\(auth\)\//, "auth"],
  [/^app\/auth\//, "auth"],
  [/^lib\/admin\//, "admin"],
  [/^app\/\(app\)\/admin\//, "admin"],
  [/^components\/banter\//, "ui"],
  [/^lib\/banter\//, "ui"],
  [/^components\/social\//, "ui"],
  [/^\.github\//, "infra"],
  [/^\.husky\//, "infra"],
  [/(^|\/)(sentry|instrumentation)/, "infra"],
  [/^lib\/cron\//, "infra"],
  [/^components\//, "ui"],
  [/^app\//, "ui"],
];

/** Dominant area among a PR's changed files (by file count). null when none match. */
export function areaFromFiles(files) {
  const tally = new Map();
  for (const f of files) {
    for (const [re, area] of PATH_RULES) {
      if (re.test(f)) {
        tally.set(area, (tally.get(area) || 0) + 1);
        break;
      }
    }
  }
  let best = null;
  let bestN = 0;
  for (const [area, n] of tally) {
    if (n > bestN) {
      best = area;
      bestN = n;
    }
  }
  return best;
}

// Word-bounded so "debug" doesn't trip "bug", etc.
const CORRECTIVE_SLUG = /\b(fix|bug|recursion|404|deeper|base-?case|follow-?up|hotfix|revert|broken|repair|empty|mismatch)\b/i;
const REVIEW_MARKER = /from code review|caught in|review|round\s*[2-9]|follow-?up/i;
const CRITICAL_MARKER = /\b(p0|critical|data ?loss|inflat|recursion|crash|security|leak)\b/i;

const clip = (s, n = 140) => (s || "").slice(0, n).trim();

/** Parse a conventional-commit subject. Returns null if it isn't one. */
export function parseConventional(subject) {
  const m = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/);
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!CONVENTIONAL_TYPES.has(type)) return null;
  const scope = m[2] || null;
  const breaking = Boolean(m[3]);
  const rest = m[4];
  const prMatch = rest.match(/\(#(\d+)\)\s*$/);
  const prNumber = prMatch ? Number(prMatch[1]) : null;
  const title = prMatch ? rest.slice(0, prMatch.index).trim() : rest.trim();
  return { type, scope, breaking, title, prNumber };
}

/** Parse a `Merge pull request #N from owner/branch` subject. */
export function parseMerge(subject) {
  const m = subject.match(/^Merge pull request #(\d+) from (\S+)/);
  if (!m) return null;
  const ref = m[2];
  const branch = ref.includes("/") ? ref.split("/").slice(1).join("/") : ref;
  return { prNumber: Number(m[1]), branch };
}

/** A `Merge branch 'main' into …` style sync commit — not a PR landing. */
export function isBranchSyncMerge(subject) {
  return /^Merge branch /.test(subject) || /^Merge remote-tracking/.test(subject);
}

/** Initials from a `<type>/<initials>/<slug>` branch; null for `claude/…`. */
export function branchInitials(branch) {
  if (!branch) return null;
  const parts = branch.split("/");
  if (parts.length >= 3 && CONVENTIONAL_TYPES.has(parts[0])) return parts[1];
  return null;
}

/** Leading branch segment (`feat`, `fix`, `claude`, …). */
export function branchType(branch) {
  if (!branch) return null;
  return branch.split("/")[0] || null;
}

/** Resolve workflow_type: prefer an area:* label, else pass the scope through. */
export function resolveWorkflowType(scope) {
  if (!scope) return "unknown";
  const s = scope.toLowerCase();
  if (AREAS.includes(s)) return s;
  if (SCOPE_TO_AREA[s]) return SCOPE_TO_AREA[s];
  return s;
}

/** Infer an area from a short branch slug. null when nothing matches. */
export function inferAreaFromSlug(slug) {
  if (!slug) return null;
  for (const [area, re] of AREA_KEYWORDS) if (re.test(slug)) return area;
  return null;
}

/**
 * Decide whether a landed PR/commit is itself a correction of prior agent work,
 * and how severe. Signals, in priority order: revert → fix → corrective branch
 * slug → review bot requested changes → CHANGELOG review marker.
 * @returns {{ correctionType: string, severity: string, reviewDriven: boolean, description: string } | null}
 */
export function decideCorrection({ type, subject = "", body = "", slug = "", changesRequested = false, changelogReview = false }) {
  const text = `${subject}\n${body}\n${slug}`;
  const reviewDriven = changesRequested || changelogReview || REVIEW_MARKER.test(text);
  const critical = CRITICAL_MARKER.test(text);

  if (type === "revert" || /^Revert\b/.test(subject)) {
    return { correctionType: "task_reopened", severity: "critical", reviewDriven, description: clip(subject) };
  }
  if (type === "fix") {
    return { correctionType: "output_edit", severity: critical ? "critical" : "major", reviewDriven, description: clip(subject) };
  }
  if (CORRECTIVE_SLUG.test(slug)) {
    return { correctionType: "output_edit", severity: critical ? "critical" : "major", reviewDriven, description: clip(slug) };
  }
  if (changesRequested) {
    return { correctionType: "plan_change", severity: "major", reviewDriven: true, description: "Review bot requested changes" };
  }
  if (changelogReview) {
    return { correctionType: "context_clarification", severity: "minor", reviewDriven: true, description: clip(subject) };
  }
  return null;
}
