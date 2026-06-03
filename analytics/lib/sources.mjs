// Raw signal sources: git first-parent history, optional GitHub (`gh`) enrichment,
// and CHANGELOG attribution. All best-effort and fail-safe — analytics must never
// be the reason something breaks.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ASCII unit/record separators keep multi-line commit bodies parseable.
const UNIT = "\x1f";
const REC = "\x1e";

/**
 * Read first-parent git history as structured commits — one entry per mainline
 * landing (a squash-merged PR, a merge commit, or a direct push).
 * @param {{ since?: string|null }} [opts]
 */
export function readCommits({ since } = {}) {
  const args = [
    "log",
    "--first-parent",
    `--format=%H${UNIT}%an${UNIT}%ae${UNIT}%aI${UNIT}%P${UNIT}%s${UNIT}%b${REC}`,
  ];
  if (since) args.push(`--since=${since}`);

  const out = execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  return out
    .split(REC)
    .map((rec) => rec.replace(/^\n/, ""))
    .filter((rec) => rec.trim().length > 0)
    .map((rec) => {
      const [hash, authorName, authorEmail, authorDate, parents, subject, body] = rec.split(UNIT);
      return {
        hash,
        authorName,
        authorEmail,
        authorDate,
        parents: (parents || "").trim().split(" ").filter(Boolean),
        subject: subject || "",
        body: body || "",
      };
    });
}

/** Files a landing changed: `git diff --name-only <hash>~1 <hash>` (PR diff for
 *  both squash and merge commits). Empty on the root commit or any failure. */
export function changedFiles(hash) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${hash}~1`, hash], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** "<owner>/<repo>" from the origin remote, or "unknown/unknown". */
export function repoSlug() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: repoRoot, encoding: "utf8" }).trim();
    const m = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : "unknown/unknown";
  } catch {
    return "unknown/unknown";
  }
}

/** Whether the `gh` CLI is available for GitHub enrichment. */
export function ghAvailable() {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Best-effort `gh api <path>` → parsed JSON, or null on any failure. */
export function ghApiJson(path) {
  try {
    const out = execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/**
 * Parse CHANGELOG.md → Map<prNumber, { initials, reviewMarker }>. Best-effort
 * attribution that fills in human initials for squash commits (which lose the
 * branch name) and flags entries that mention review/"Round N"/follow-up.
 */
export function readChangelogAttribution() {
  const map = new Map();
  let text;
  try {
    text = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
  } catch {
    return map;
  }
  const reviewRe = /from code review|caught in (?:pr\s*)?#?\d+|round\s*[2-9]|follow-?up/i;
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("- ")) continue;
    const initialsMatch = line.match(/—\s*@([A-Za-z?]+)\s*$/);
    const initials = initialsMatch ? initialsMatch[1] : null;
    const reviewMarker = reviewRe.test(line);
    for (const prMatch of line.matchAll(/#(\d+)/g)) {
      const pr = Number(prMatch[1]);
      const prev = map.get(pr) || { initials: null, reviewMarker: false };
      map.set(pr, {
        initials: prev.initials || initials,
        reviewMarker: prev.reviewMarker || reviewMarker,
      });
    }
  }
  return map;
}
