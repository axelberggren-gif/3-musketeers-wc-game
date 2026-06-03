// Optional LOCAL-ONLY enrichment. Claude Code hooks (see .claude/settings.json) pipe
// their JSON payload to this script on stdin; we append a thin telemetry row to
// analytics/events/local.ndjson (gitignored).
//
// Claude Code hooks do NOT run for Claude Code on the web, so this captures local
// CLI/desktop sessions only — the GitHub Action is the universal pipeline. This script
// always exits 0 and never writes to stdout: analytics must never disrupt a session.

import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const kind = process.argv[2] || "session_event";

async function readStdin() {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return "";
  }
}

const raw = await readStdin();
let payload = {};
try {
  payload = raw ? JSON.parse(raw) : {};
} catch {
  payload = {};
}

try {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "events");
  mkdirSync(dir, { recursive: true });
  const row = {
    event: kind,
    session_id: payload.session_id ?? null,
    hook_event: payload.hook_event_name ?? null,
    source: payload.source ?? null,
    tool_name: payload.tool_name ?? null,
    cwd: payload.cwd ?? null,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(join(dir, "local.ndjson"), JSON.stringify(row) + "\n");
} catch {
  // Swallow — never break the session.
}

process.exit(0);
