import type { Pick1X2 } from "@/lib/supabase/types";

// Which slots feed each knockout slot, per FIFA's official WC 2026 bracket.
//
// Slots are numbered by FIFA MATCH NUMBER (R32-1..16 = Matches 73..88, R16-1..8
// = Matches 89..96, QF-A..D = Matches 97..100, SF-A/B = Matches 101/102,
// F = Match 104) — NOT by kickoff order. football-data's kickoff order (and
// `external_id` order) does not match FIFA's numbering, so `syncFixtures()`
// pins R32 by the realised matchup (`R32_MATCHUP_SLOT`) and derives R16/QF/SF
// from lineage (`knockoutSlotByFeeders()`), never from a kickoff sort. The
// official bracket does NOT pair adjacent matches (e.g. M89 = Winner M74 vs
// Winner M77, not M73 vs M74), so this map encodes the real feeds, not the
// naive "R32-(2N-1) + R32-2N → R16-N" assumption (which produced impossible R16
// meetings like the two sides of one half facing each other).
//
// Source: FIFA / Wikipedia "2026 FIFA World Cup knockout stage" match grid.
//   R16: M89=W74,W77 · M90=W73,W75 · M91=W76,W78 · M92=W79,W80
//        M93=W83,W84 · M94=W81,W82 · M95=W86,W88 · M96=W85,W87
//   QF:  M97=W89,W90 · M98=W93,W94 · M99=W91,W92 · M100=W95,W96
//   SF:  M101=W97,W98 · M102=W99,W100   F: M104=W101,W102
export const BRACKET_UPSTREAM: Record<string, readonly string[]> = {
  "R16-1": ["R32-2", "R32-5"], // M89: W74 vs W77
  "R16-2": ["R32-1", "R32-3"], // M90: W73 vs W75
  "R16-3": ["R32-4", "R32-6"], // M91: W76 vs W78
  "R16-4": ["R32-7", "R32-8"], // M92: W79 vs W80
  "R16-5": ["R32-11", "R32-12"], // M93: W83 vs W84
  "R16-6": ["R32-9", "R32-10"], // M94: W81 vs W82
  "R16-7": ["R32-14", "R32-16"], // M95: W86 vs W88
  "R16-8": ["R32-13", "R32-15"], // M96: W85 vs W87
  "QF-A": ["R16-1", "R16-2"], // M97: W89 vs W90
  "QF-B": ["R16-5", "R16-6"], // M98: W93 vs W94
  "QF-C": ["R16-3", "R16-4"], // M99: W91 vs W92
  "QF-D": ["R16-7", "R16-8"], // M100: W95 vs W96
  "SF-A": ["QF-A", "QF-B"], // M101: W97 vs W98
  "SF-B": ["QF-C", "QF-D"], // M102: W99 vs W100
  F: ["SF-A", "SF-B"], // M104: W101 vs W102
  W: ["F"],
} as const;

export function upstreamSlots(slot: string): readonly string[] {
  return BRACKET_UPSTREAM[slot] ?? [];
}

// Invert BRACKET_UPSTREAM: given the two feeder slots whose winners contest a
// knockout match, return that match's canonical slot (or null if no slot has
// exactly those two feeders). Order-independent. Lets syncFixtures() slot
// R16/QF/SF matches from the bracket *lineage* (which teams advanced from which
// slots) instead of kickoff order — football-data schedules tightly-packed
// rounds (R16 especially) in an order that does NOT match FIFA's bracket
// numbering, so kickoff order mis-pairs them. 'F'/'3RD' are unique per stage and
// assigned directly by syncFixtures(), not resolved here.
export function knockoutSlotByFeeders(feederA: string, feederB: string): string | null {
  const want = [feederA, feederB].sort().join("|");
  for (const [slot, ups] of Object.entries(BRACKET_UPSTREAM)) {
    if (ups.length !== 2) continue;
    if ([...ups].sort().join("|") === want) return slot;
  }
  return null;
}

// ── Official WC 2026 Round-of-32 qualification map ──────────────────────────
// Each R32 slot is one real first-knockout-round match. The two sides are
// group-finishing positions per FIFA's published schedule (Matches 73–88).
// Slots are numbered R32-1..16 = Matches 73..88 in schedule (kickoff) order, to
// line up with `syncFixtures()`/`deriveBracketSlot()`, which assigns the real
// imported fixtures to R32-1..16 by kickoff order. The third-place sides list
// the five candidate groups; exactly which third-placed team lands there is
// decided by FIFA's Annex C matrix once the group stage finishes — we don't
// reproduce that table, we let the imported real fixture fill those sides.
export type QualSource =
  | { kind: "winner"; group: string }
  | { kind: "runnerup"; group: string }
  | { kind: "third"; groups: readonly string[] };

export const R32_QUALIFIERS: Record<string, readonly [QualSource, QualSource]> = {
  "R32-1": [{ kind: "runnerup", group: "A" }, { kind: "runnerup", group: "B" }], // M73
  "R32-2": [{ kind: "winner", group: "E" }, { kind: "third", groups: ["A", "B", "C", "D", "F"] }], // M74
  "R32-3": [{ kind: "winner", group: "F" }, { kind: "runnerup", group: "C" }], // M75
  "R32-4": [{ kind: "winner", group: "C" }, { kind: "runnerup", group: "F" }], // M76
  "R32-5": [{ kind: "winner", group: "I" }, { kind: "third", groups: ["C", "D", "F", "G", "H"] }], // M77
  "R32-6": [{ kind: "runnerup", group: "E" }, { kind: "runnerup", group: "I" }], // M78
  "R32-7": [{ kind: "winner", group: "A" }, { kind: "third", groups: ["C", "E", "F", "H", "I"] }], // M79
  "R32-8": [{ kind: "winner", group: "L" }, { kind: "third", groups: ["E", "H", "I", "J", "K"] }], // M80
  "R32-9": [{ kind: "winner", group: "D" }, { kind: "third", groups: ["B", "E", "F", "I", "J"] }], // M81
  "R32-10": [{ kind: "winner", group: "G" }, { kind: "third", groups: ["A", "E", "H", "I", "J"] }], // M82
  "R32-11": [{ kind: "runnerup", group: "K" }, { kind: "runnerup", group: "L" }], // M83
  "R32-12": [{ kind: "winner", group: "H" }, { kind: "runnerup", group: "J" }], // M84
  "R32-13": [{ kind: "winner", group: "B" }, { kind: "third", groups: ["E", "F", "G", "I", "J"] }], // M85
  "R32-14": [{ kind: "winner", group: "J" }, { kind: "runnerup", group: "H" }], // M86
  "R32-15": [{ kind: "winner", group: "K" }, { kind: "third", groups: ["D", "E", "I", "J", "L"] }], // M87
  "R32-16": [{ kind: "runnerup", group: "D" }, { kind: "runnerup", group: "G" }], // M88
} as const;

// Short qualification placeholder for a side that isn't a known team yet.
export function qualSourceLabel(s: QualSource): string {
  if (s.kind === "winner") return `Winner Group ${s.group}`;
  if (s.kind === "runnerup") return `Runner-up Group ${s.group}`;
  return `3rd Group ${s.groups.join("/")}`;
}

// ── Canonical WC 2026 Round-of-32 matchup → bracket slot ────────────────────
// The entry round (R32) CANNOT be slotted by kickoff order: football-data
// schedules the 16 R32 kickoffs in an order that does not match FIFA's bracket
// numbering (e.g. BRA/JPN — FIFA Match 76 — kicks off before GER/PAR — M74),
// and match `external_id` order is likewise not FIFA order. Downstream rounds
// then inherit the scramble through BRACKET_UPSTREAM, mis-pairing teams (the
// France-vs-Morocco-in-the-Round-of-16 bug). So we pin each realised R32
// matchup to its FIFA slot explicitly. Keyed on the two team codes
// (football-data TLA / `teams.code`), sorted then joined with "/" so home/away
// order is irrelevant. Verified against the official FIFA grid (Matches 73–88)
// and the live imported fixtures. R16/QF/SF are then derived from results via
// knockoutSlotByFeeders(); 'F'/'3RD' are unique per stage.
export const R32_MATCHUP_SLOT: Record<string, string> = {
  "CAN/RSA": "R32-1", // M73
  "GER/PAR": "R32-2", // M74
  "MAR/NED": "R32-3", // M75
  "BRA/JPN": "R32-4", // M76
  "FRA/SWE": "R32-5", // M77
  "CIV/NOR": "R32-6", // M78
  "ECU/MEX": "R32-7", // M79
  "COD/ENG": "R32-8", // M80
  "BIH/USA": "R32-9", // M81
  "BEL/SEN": "R32-10", // M82
  "CRO/POR": "R32-11", // M83
  "AUT/ESP": "R32-12", // M84
  "ALG/SUI": "R32-13", // M85
  "ARG/CPV": "R32-14", // M86
  "COL/GHA": "R32-15", // M87
  "AUS/EGY": "R32-16", // M88
};

// Canonical R32 slot for a realised matchup, by the two team codes (any order).
// Returns null if either side is unknown or the pair isn't a recognised R32 tie.
export function r32SlotForMatchup(codeA: string | null, codeB: string | null): string | null {
  if (!codeA || !codeB) return null;
  return R32_MATCHUP_SLOT[[codeA, codeB].sort().join("/")] ?? null;
}

// Human round name + index for a knockout slot, used in "Winner of …" feeder
// labels on downstream cells (e.g. SF-A's feeder QF-A → "Quarter-final 1").
export function slotFriendlyName(slot: string): string {
  if (slot === "F") return "Final";
  if (slot === "W") return "Champion";
  const [stage, n] = slot.split("-");
  const idx = /^[A-Z]$/.test(n) ? n.charCodeAt(0) - 64 : Number(n); // A→1, "3"→3
  switch (stage) {
    case "R32":
      return `Round of 32 #${idx}`;
    case "R16":
      return `Round of 16 #${idx}`;
    case "QF":
      return `Quarter-final ${idx}`;
    case "SF":
      return `Semi-final ${idx}`;
    default:
      return slot;
  }
}

// ── Real group standings → winner / runner-up (from football-data results) ──
export type RealGroupMatch = {
  group_letter: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
};

export type GroupFinal = {
  winnerTeamId: string | null;
  runnerUpTeamId: string | null;
  /** True only once every match in the group is FINISHED, so 1st/2nd are fixed. */
  complete: boolean;
};

type Tally = { teamId: string; pts: number; gd: number; gf: number; played: number; total: number };

// Final 1st/2nd per group, derived from real scores. A group resolves only when
// all its matches are FINISHED (so the positions can't still change). Ordering:
// points, then goal difference, then goals for, then team id (deterministic
// last resort — head-to-head tiebreaks aren't modelled; the real imported R32
// fixture is authoritative and overrides this once football-data lands it).
export function computeGroupFinals(matches: RealGroupMatch[]): Record<string, GroupFinal> {
  const byGroup = new Map<string, Map<string, Tally>>();
  const seen = new Map<string, { finished: number; total: number }>();

  const tallyFor = (group: string, teamId: string) => {
    let g = byGroup.get(group);
    if (!g) {
      g = new Map();
      byGroup.set(group, g);
    }
    let t = g.get(teamId);
    if (!t) {
      t = { teamId, pts: 0, gd: 0, gf: 0, played: 0, total: 0 };
      g.set(teamId, t);
    }
    return t;
  };

  for (const m of matches) {
    const group = m.group_letter;
    if (!group || !m.home_team_id || !m.away_team_id) continue;
    const counts = seen.get(group) ?? { finished: 0, total: 0 };
    counts.total += 1;
    const home = tallyFor(group, m.home_team_id);
    const away = tallyFor(group, m.away_team_id);
    if (m.status === "FINISHED" && m.home_score != null && m.away_score != null) {
      counts.finished += 1;
      home.played += 1;
      away.played += 1;
      home.gf += m.home_score;
      away.gf += m.away_score;
      home.gd += m.home_score - m.away_score;
      away.gd += m.away_score - m.home_score;
      if (m.home_score > m.away_score) home.pts += 3;
      else if (m.home_score < m.away_score) away.pts += 3;
      else {
        home.pts += 1;
        away.pts += 1;
      }
    }
    seen.set(group, counts);
  }

  const out: Record<string, GroupFinal> = {};
  for (const [group, teams] of byGroup) {
    const counts = seen.get(group)!;
    const complete = counts.total > 0 && counts.finished === counts.total;
    if (!complete) {
      out[group] = { winnerTeamId: null, runnerUpTeamId: null, complete: false };
      continue;
    }
    const sorted = [...teams.values()].sort(
      (a, b) =>
        b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.teamId.localeCompare(b.teamId),
    );
    out[group] = {
      winnerTeamId: sorted[0]?.teamId ?? null,
      runnerUpTeamId: sorted[1]?.teamId ?? null,
      complete: true,
    };
  }
  return out;
}

export const GROUP_LETTERS = [
  "A", "B", "C", "D", "E", "F",
  "G", "H", "I", "J", "K", "L",
] as const;

export type GroupMatch = {
  id: string;
  group_letter: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};

export type GroupStanding = {
  teamId: string;
  groupLetter: string;
  points: number;
  played: number;
};

export function predictedGroupStandings(
  matches: GroupMatch[],
  picksByMatchId: Record<string, Pick1X2>,
): GroupStanding[] {
  const acc = new Map<string, GroupStanding>();

  const seed = (teamId: string, groupLetter: string) => {
    const key = `${groupLetter}:${teamId}`;
    if (!acc.has(key)) {
      acc.set(key, { teamId, groupLetter, points: 0, played: 0 });
    }
    return acc.get(key)!;
  };

  for (const m of matches) {
    if (!m.group_letter || !m.home_team_id || !m.away_team_id) continue;
    const home = seed(m.home_team_id, m.group_letter);
    const away = seed(m.away_team_id, m.group_letter);
    const pick = picksByMatchId[m.id];
    if (!pick) continue;
    home.played += 1;
    away.played += 1;
    if (pick === "HOME") home.points += 3;
    else if (pick === "AWAY") away.points += 3;
    else {
      home.points += 1;
      away.points += 1;
    }
  }

  return [...acc.values()];
}

export type Qualifier = { slot: string; teamId: string };

export type BracketSlotMatchPair = {
  homeTeamId: string;
  awayTeamId: string;
};

export const R32_SLOT_COUNT = 16;

/**
 * Drop suggestions whose team isn't part of the real match for that slot.
 *
 * Pre-group-stage-end the `slotMatches` map is empty and every suggestion passes
 * through. Once football-data lands R32 matches (`syncFixtures()` derives
 * `bracket_slot = R32-1..R32-16`), a suggestion of "Brazil wins R32-3" only
 * survives if Brazil is one of the two teams in the R32-3 match — otherwise the
 * bulk upsert would write a stale pick the user can't toggle via the
 * `MatchSlotPicker` tile UI (only the two real teams are shown).
 */
export function filterSuggestionsByMatchPairs(
  suggestions: Qualifier[],
  slotMatches: Record<string, BracketSlotMatchPair>,
): Qualifier[] {
  return suggestions.filter((q) => {
    const match = slotMatches[q.slot];
    if (!match) return true;
    return match.homeTeamId === q.teamId || match.awayTeamId === q.teamId;
  });
}

export function suggestR32Qualifiers(
  standings: GroupStanding[],
  teamNameById: Record<string, string>,
): Qualifier[] {
  const byGroup = new Map<string, GroupStanding[]>();
  for (const s of standings) {
    const arr = byGroup.get(s.groupLetter) ?? [];
    arr.push(s);
    byGroup.set(s.groupLetter, arr);
  }

  const sortStanding = (a: GroupStanding, b: GroupStanding) => {
    if (b.points !== a.points) return b.points - a.points;
    return (teamNameById[a.teamId] ?? a.teamId).localeCompare(
      teamNameById[b.teamId] ?? b.teamId,
    );
  };

  const advancers: GroupStanding[] = [];
  for (const letter of GROUP_LETTERS) {
    const sorted = (byGroup.get(letter) ?? []).slice().sort(sortStanding);
    if (sorted[0]) advancers.push(sorted[0]);
    if (sorted[1]) advancers.push(sorted[1]);
  }

  const top = advancers.sort(sortStanding).slice(0, R32_SLOT_COUNT);
  return top.map((s, idx) => ({ slot: `R32-${idx + 1}`, teamId: s.teamId }));
}
