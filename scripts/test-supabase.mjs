import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

function badge(ok) {
  return ok ? "✅" : "❌";
}

console.log("Project URL:", url || "(missing)");
console.log("anon key:   ", anon ? `${anon.slice(0, 12)}…${anon.slice(-6)}` : "(missing)");
console.log("service key:", service ? `${service.slice(0, 12)}…${service.slice(-6)}` : "(missing)");
console.log("");

if (!url || !anon || !service) {
  console.error("Missing one or more env vars in .env.local — fix that first.");
  process.exit(1);
}

const anonClient = createClient(url, anon, { auth: { persistSession: false } });
const adminClient = createClient(url, service, { auth: { persistSession: false } });

const TABLES = ["tournament", "profiles", "leagues", "matches", "match_predictions", "point_awards"];

let allOk = true;

console.log("Checking core tables exist (via service role):");
for (const t of TABLES) {
  const { error, count } = await adminClient
    .from(t)
    .select("*", { count: "exact", head: true });
  const ok = !error;
  if (!ok) allOk = false;
  console.log(`  ${badge(ok)} ${t.padEnd(20)} ${ok ? `${count ?? 0} rows` : `error: ${error.message}`}`);
}
console.log("");

console.log("Checking tournament row is seeded:");
const { data: tourn, error: tournErr } = await adminClient
  .from("tournament")
  .select("first_kickoff_at, knockout_start_at, final_at")
  .eq("id", 1)
  .maybeSingle();
if (tournErr) {
  console.log(`  ❌ ${tournErr.message}`);
  allOk = false;
} else if (!tourn) {
  console.log("  ❌ tournament row id=1 missing — migration 0001 may not have applied");
  allOk = false;
} else {
  console.log(`  ✅ first kickoff: ${tourn.first_kickoff_at}`);
  console.log(`  ✅ knockouts:    ${tourn.knockout_start_at}`);
  console.log(`  ✅ final:        ${tourn.final_at}`);
}
console.log("");

console.log("Checking RLS — anon key should NOT see profiles:");
const { data: anonProfiles, error: anonErr } = await anonClient
  .from("profiles")
  .select("id", { count: "exact", head: false })
  .limit(1);
if (anonErr) {
  console.log(`  ⚠️  anon query errored: ${anonErr.message} (this is usually fine — RLS blocking)`);
} else if (!anonProfiles || anonProfiles.length === 0) {
  console.log("  ✅ anon sees 0 profiles (RLS is doing its job)");
} else {
  console.log("  ❌ anon read a profile — RLS misconfigured?");
  allOk = false;
}
console.log("");

console.log("Checking scoring RPCs exist:");
for (const fn of ["score_match", "score_bracket", "score_tournament", "refresh_league_standings"]) {
  let ok = false;
  let msg = "";
  if (fn === "score_match") {
    const { error } = await adminClient.rpc("score_match", {
      p_match_id: "00000000-0000-0000-0000-000000000000",
    });
    ok = !error || error.message.includes("invalid input syntax") === false;
    msg = error ? error.message : "callable";
  } else {
    const { error } = await adminClient.rpc(fn);
    ok = !error;
    msg = error ? error.message : "callable";
  }
  if (!ok) allOk = false;
  console.log(`  ${badge(ok)} ${fn.padEnd(28)} ${msg}`);
}
console.log("");

console.log(allOk ? "All checks passed. 🟢" : "Some checks failed — see above. 🔴");
process.exit(allOk ? 0 : 1);
