// Backfill / live-capture miner. Emits normalized analytics events from git +
// (optionally) GitHub history.
//
//   node analytics/scripts/backfill.mjs                 # full history → events/log.ndjson
//   node analytics/scripts/backfill.mjs --since 2026-05-01
//   node analytics/scripts/backfill.mjs --pr 61 --stdout # one PR's events to stdout (Action appends)
//   node analytics/scripts/backfill.mjs --no-github      # skip gh enrichment (git-only)

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEvents } from "../lib/collect.mjs";

const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const since = getFlag("--since");
const prFlag = getFlag("--pr");
const pr = prFlag ? Number(prFlag) : null;
const toStdout = args.includes("--stdout");
const useGithub = !args.includes("--no-github");

const { events, meta } = collectEvents({ since, pr, useGithub });

if (toStdout) {
  for (const e of events) process.stdout.write(`${JSON.stringify(e)}\n`);
} else {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "events");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, "log.ndjson");
  writeFileSync(outFile, events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
  console.log(`Wrote ${events.length} events from ${meta.commitsScanned} commits → ${outFile}`);
  console.log(`Runs: ${meta.totalRuns} · GitHub-enriched: ${meta.githubEnriched ? "yes" : "no (git-only)"}`);
}
