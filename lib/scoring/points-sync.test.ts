import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { POINTS } from "./rules";

// ---------------------------------------------------------------------------
// SQL ↔ TS points-sync guard.
//
// rules.test.ts pins every POINTS leaf, but CI never executes SQL — so a new
// migration that redefines (or drops) a points_*() constant used to merge
// green while the DB and rules.ts silently diverged. This test closes the
// other half of the invariant: it parses supabase/migrations/*.sql in lexical
// apply order, derives the LIVE set of points_*() functions (last definition
// wins; `drop function` removes the entry — exactly what Postgres ends up
// with), and asserts it against an explicit mapping table in BOTH directions:
//
//   1. every mapped SQL constant returns exactly its POINTS twin's value;
//   2. the live SQL function set equals exactly the mapped set — a brand-new
//      unmapped points_*() function, or a dropped one, fails loudly;
//   3. points_bracket_slot()'s CASE arms equal POINTS.bracket per slot prefix.
//
// If this test fails you, the fix is always the same three-legged edit:
//   * a NEW migration (append-only — never edit a merged one) that
//     creates/replaces/drops the SQL function,
//   * the matching lib/scoring/rules.ts change (+ rules.test.ts),
//   * the SQL_CONSTANT_MAPPING entry below.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "supabase",
  "migrations",
);

// The single source of truth tying each SQL constant function to its POINTS
// leaf. `tsPath` is only used in failure messages.
const SQL_CONSTANT_MAPPING: { sqlName: string; tsPath: string; tsValue: number }[] = [
  { sqlName: "points_match_1x2", tsPath: "POINTS.match1x2", tsValue: POINTS.match1x2 },
  { sqlName: "points_tournament_winner", tsPath: "POINTS.tournament.winner", tsValue: POINTS.tournament.winner },
  { sqlName: "points_tournament_runner_up", tsPath: "POINTS.tournament.runnerUp", tsValue: POINTS.tournament.runnerUp },
  { sqlName: "points_top_scorer", tsPath: "POINTS.tournament.topScorer", tsValue: POINTS.tournament.topScorer },
  { sqlName: "points_total_goals_base", tsPath: "POINTS.tournament.totalGoalsBase", tsValue: POINTS.tournament.totalGoalsBase },
  { sqlName: "points_highest_match_base", tsPath: "POINTS.tournament.highestMatchBase", tsValue: POINTS.tournament.highestMatchBase },
  { sqlName: "points_troublemaker", tsPath: "POINTS.tournament.troublemaker", tsValue: POINTS.tournament.troublemaker },
  { sqlName: "points_first_eliminated", tsPath: "POINTS.tournament.firstEliminated", tsValue: POINTS.tournament.firstEliminated },
  { sqlName: "points_final_goals_base", tsPath: "POINTS.tournament.finalGoalsBase", tsValue: POINTS.tournament.finalGoalsBase },
  { sqlName: "points_biggest_win_margin_base", tsPath: "POINTS.tournament.biggestWinMarginBase", tsValue: POINTS.tournament.biggestWinMarginBase },
  { sqlName: "points_golden_boot_goals_base", tsPath: "POINTS.tournament.goldenBootGoalsBase", tsValue: POINTS.tournament.goldenBootGoalsBase },
  { sqlName: "points_total_red_cards_base", tsPath: "POINTS.tournament.totalRedCardsBase", tsValue: POINTS.tournament.totalRedCardsBase },
  { sqlName: "points_player_prop", tsPath: "POINTS.playerProp", tsValue: POINTS.playerProp },
  { sqlName: "points_manual_prop", tsPath: "POINTS.manualProp", tsValue: POINTS.manualProp },
  { sqlName: "points_league_loser_guess", tsPath: "POINTS.leagueBet.loserGuess", tsValue: POINTS.leagueBet.loserGuess },
  { sqlName: "points_league_loser_per_vote", tsPath: "POINTS.leagueBet.loserPerVote", tsValue: POINTS.leagueBet.loserPerVote },
  { sqlName: "points_league_crown_penalty_per_vote", tsPath: "POINTS.leagueBet.crownPenaltyPerVote", tsValue: POINTS.leagueBet.crownPenaltyPerVote },
];

// points_bracket_slot(slot text) is the one parameterised points function:
// its CASE arms map slot patterns to values. Asserted against POINTS.bracket.
const EXPECTED_BRACKET_ARMS: Record<string, number> = {
  "R32-%": POINTS.bracket.R32,
  "R16-%": POINTS.bracket.R16,
  "QF-%": POINTS.bracket.QF,
  "SF-%": POINTS.bracket.SF,
  F: POINTS.bracket.F,
  W: POINTS.bracket.WINNER,
};

// ---------------------------------------------------------------------------
// Parser. Patterns are anchored to the REAL formatting used across the
// migrations (verified against 0002, 0005, 0013, 0018, 0020, 0021, 0022,
// 0023): constants are single-statement
//   create or replace function points_x()   returns integer language sql
//   immutable as $$ select N $$;
// with variable run-of-spaces alignment padding; drops are
//   drop function if exists points_x();
// and points_bracket_slot is the multi-line CASE form. Comments are stripped
// first so prose mentioning a function name can never register as an event.
// ---------------------------------------------------------------------------

type LiveEntry =
  | { kind: "constant"; value: number; definedIn: string }
  | { kind: "bracket"; arms: Record<string, number>; hasElseZero: boolean; definedIn: string };

const CONSTANT_DEF_RE =
  /create\s+or\s+replace\s+function\s+(points_[a-z0-9_]+)\s*\(\s*\)\s+returns\s+integer\s+language\s+sql\s+immutable\s+as\s+\$\$\s*select\s+(\d+)\s*\$\$/gi;

const BRACKET_DEF_RE =
  /create\s+or\s+replace\s+function\s+(points_bracket_slot)\s*\(\s*slot\s+text\s*\)\s+returns\s+integer\s+language\s+sql\s+immutable\s+as\s+\$\$([\s\S]*?)\$\$/gi;

const BRACKET_ARM_RE = /when\s+slot\s+(?:like|=)\s+'([^']+)'\s+then\s+(\d+)/gi;

// Matches both `drop function points_x()` and `drop function if exists
// points_x();` (arg list, if any, doesn't matter for identity here — every
// points_* name has a single overload).
const DROP_RE = /drop\s+function\s+(?:if\s+exists\s+)?(points_[a-z0-9_]+)\s*\(/gi;

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function buildLiveSqlState(): Map<string, LiveEntry> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexical order == apply order (NNNN_ prefix)

  const live = new Map<string, LiveEntry>();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));

    // Collect every event in this file with its character offset, then apply
    // them in source order — so a (hypothetical) drop-then-recreate within
    // one migration resolves the same way Postgres would.
    type Event =
      | { index: number; type: "constant"; name: string; value: number }
      | { index: number; type: "bracket"; name: string; body: string }
      | { index: number; type: "drop"; name: string };
    const events: Event[] = [];

    for (const m of sql.matchAll(CONSTANT_DEF_RE)) {
      events.push({ index: m.index, type: "constant", name: m[1].toLowerCase(), value: Number(m[2]) });
    }
    for (const m of sql.matchAll(BRACKET_DEF_RE)) {
      events.push({ index: m.index, type: "bracket", name: m[1].toLowerCase(), body: m[2] });
    }
    for (const m of sql.matchAll(DROP_RE)) {
      events.push({ index: m.index, type: "drop", name: m[1].toLowerCase() });
    }

    events.sort((a, b) => a.index - b.index);

    for (const ev of events) {
      if (ev.type === "drop") {
        live.delete(ev.name);
      } else if (ev.type === "constant") {
        live.set(ev.name, { kind: "constant", value: ev.value, definedIn: file });
      } else {
        const arms: Record<string, number> = {};
        for (const arm of ev.body.matchAll(BRACKET_ARM_RE)) {
          arms[arm[1]] = Number(arm[2]);
        }
        live.set(ev.name, {
          kind: "bracket",
          arms,
          hasElseZero: /else\s+0/i.test(ev.body),
          definedIn: file,
        });
      }
    }
  }

  return live;
}

const live = buildLiveSqlState();

describe("points-sync: SQL points_*() functions ↔ lib/scoring/rules.ts POINTS", () => {
  it("parser found the live SQL state (regexes haven't rotted)", () => {
    // If a future formatting change breaks the patterns, this fails before
    // the subtler assertions can pass vacuously.
    expect(live.size).toBeGreaterThan(0);
    expect(live.has("points_match_1x2")).toBe(true);
    expect(live.has("points_bracket_slot")).toBe(true);
  });

  for (const { sqlName, tsPath, tsValue } of SQL_CONSTANT_MAPPING) {
    it(`${sqlName}() === ${tsPath} (${tsValue})`, () => {
      const entry = live.get(sqlName);
      expect(
        entry,
        `${sqlName}() is mapped to ${tsPath} but no live definition survives the migrations. ` +
          `If it was dropped on purpose: remove the ${tsPath} leaf from rules.ts AND this mapping entry. ` +
          `If not: add a NEW migration recreating it (migrations are append-only).`,
      ).toBeDefined();
      if (!entry) return; // unreachable — narrows the type after the expect above
      expect(entry.kind).toBe("constant");
      if (entry.kind !== "constant") return;
      expect(
        entry.value,
        `${sqlName}() (last defined in ${entry.definedIn}) returns ${entry.value} but ${tsPath} is ${tsValue}. ` +
          `Changing a point value is a three-legged edit: a NEW migration redefining ${sqlName}(), ` +
          `the rules.ts twin (+ rules.test.ts), and — if the leaf moved — this mapping.`,
      ).toBe(tsValue);
    });
  }

  it("the live SQL points_*() set equals exactly the mapped set (nothing unmapped, nothing missing)", () => {
    const mapped = new Set(SQL_CONSTANT_MAPPING.map((m) => m.sqlName));
    mapped.add("points_bracket_slot"); // parameterised; asserted arm-by-arm below

    const liveNames = [...live.keys()].sort();
    const unmapped = liveNames.filter((n) => !mapped.has(n));
    const missing = [...mapped].filter((n) => !live.has(n)).sort();

    expect(
      unmapped,
      `Live SQL points_*() functions with no POINTS mapping: ${unmapped.join(", ")}. ` +
        `A new SQL constant needs a rules.ts twin AND an SQL_CONSTANT_MAPPING entry in this test — ` +
        `nothing is excluded silently.`,
    ).toEqual([]);
    expect(
      missing,
      `Mapped points_*() functions with no live SQL definition: ${missing.join(", ")}. ` +
        `Either add a NEW migration defining them, or retire the rules.ts leaf + mapping together.`,
    ).toEqual([]);
  });

  it("points_dark_horse() and points_group_winner() stay dropped (0018 / 0021)", () => {
    // Both were created in 0002/0005 and later dropped — the parser must end
    // with them absent or the last-definition-wins / drop handling is broken.
    expect(live.has("points_dark_horse")).toBe(false);
    expect(live.has("points_group_winner")).toBe(false);
  });

  it("points_bracket_slot() CASE arms === POINTS.bracket (live owner: 0013)", () => {
    const entry = live.get("points_bracket_slot");
    expect(entry).toBeDefined();
    if (!entry) return; // unreachable — narrows the type after the expect above
    expect(entry.kind).toBe("bracket");
    if (entry.kind !== "bracket") return;
    expect(
      entry.arms,
      `points_bracket_slot() (last defined in ${entry.definedIn}) arms diverge from POINTS.bracket. ` +
        `A bracket value change needs a NEW migration redefining the CASE + the rules.ts twin.`,
    ).toEqual(EXPECTED_BRACKET_ARMS);
    // Unknown slots (e.g. '3RD') must keep falling through to 0, mirroring
    // bracketPointsForSlot()'s unknown-slot behaviour.
    expect(entry.hasElseZero).toBe(true);
  });
});
