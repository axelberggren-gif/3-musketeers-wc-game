import { describe, expect, it } from "vitest";
import {
  avgPickLead,
  bracketSurvivalOf,
  computeBoldness,
  computePersonality,
  countUpsets,
  groupAccuracyOf,
  knockoutAccuracyOf,
  largestRemainderPct,
  presentLadder,
  buildStagesWonByTeam,
  buildPlayedCountByTeam,
  type PersonalityInput,
} from "./personality";

// ── helpers to build fixtures ────────────────────────────────────────────────
type W = "HOME" | "DRAW" | "AWAY";
const groupMatch = (status: string, winner: W | null, home = "t1", away = "t2", kickoff = "2026-06-11T20:00:00Z") => ({
  id: "m",
  stage: "GROUP",
  kickoff_at: kickoff,
  status,
  winner,
  home_team_id: home,
  away_team_id: away,
});
const ko = (stage: string, bracket_slot: string, status: string, winner: W | null, home: string, away: string) => ({
  bracket_slot,
  stage,
  status,
  winner,
  home_team_id: home,
  away_team_id: away,
});

const EMPTY: PersonalityInput = {
  ownMatchPicks: [],
  ownBracketPicks: [],
  knockoutMatches: [],
  ranksByTeam: new Map(),
  cohortMatchPicks: [],
  cohortBracketPicks: [],
  cohortIds: [],
  userId: "u1",
  leagueCount: 0,
  isSelf: true,
};

describe("largestRemainderPct", () => {
  it("returns null when total is zero", () => {
    expect(largestRemainderPct(0, 0, 0)).toBeNull();
  });
  it("always sums to exactly 100", () => {
    for (const [h, d, a] of [
      [1, 1, 1],
      [5, 0, 0],
      [2, 3, 7],
      [13, 11, 9],
    ] as const) {
      const p = largestRemainderPct(h, d, a)!;
      expect(p.home + p.draw + p.away).toBe(100);
    }
  });
  it("hands the leftover to the largest fractional remainder", () => {
    expect(largestRemainderPct(1, 1, 1)).toEqual({ home: 34, draw: 33, away: 33 });
  });
});

describe("groupAccuracyOf", () => {
  it("counts only finished group matches and matches pick to winner", () => {
    const rows = [
      { pick: "HOME" as const, submitted_at: "", match: groupMatch("FINISHED", "HOME") }, // correct
      { pick: "AWAY" as const, submitted_at: "", match: groupMatch("FINISHED", "HOME") }, // wrong
      { pick: "DRAW" as const, submitted_at: "", match: groupMatch("SCHEDULED", null) }, // not finished
      { pick: "HOME" as const, submitted_at: "", match: null }, // no match
    ];
    expect(groupAccuracyOf(rows)).toEqual({ sample: 2, correct: 1 });
  });
});

describe("knockoutAccuracyOf", () => {
  const bySlot = new Map([
    ["R16-1", ko("R16", "R16-1", "FINISHED", "HOME", "tA", "tB")],
    ["QF-A", ko("QF", "QF-A", "FINISHED", "AWAY", "tC", "tD")],
    ["SF-A", ko("SF", "SF-A", "SCHEDULED", null, "tE", "tF")],
  ]);
  it("scores decided slots, ignores undecided and excludes W/3RD", () => {
    const picks = [
      { bracket_slot: "R16-1", team_id: "tA" }, // correct (HOME won)
      { bracket_slot: "QF-A", team_id: "tC" }, // wrong (AWAY won)
      { bracket_slot: "SF-A", team_id: "tE" }, // undecided
      { bracket_slot: "W", team_id: "tA" }, // excluded (champion → survival)
      { bracket_slot: "3RD", team_id: "tA" }, // excluded
    ];
    expect(knockoutAccuracyOf(picks, bySlot)).toEqual({ sample: 2, correct: 1 });
  });
});

describe("bracketSurvivalOf", () => {
  const ladder = ["R32", "R16", "QF", "SF", "F"];
  it("returns null with no champion pick", () => {
    expect(bracketSurvivalOf(null, new Map(), new Map(), ladder)).toEqual({ value: null, sample: 0 });
  });
  it("returns null when the champion never played a finished KO match", () => {
    expect(bracketSurvivalOf("tX", new Map(), new Map(), ladder)).toEqual({ value: null, sample: 0 });
  });
  it("champion that won the Final scores 1.0", () => {
    const won = new Map([["tX", new Set(["R32", "R16", "QF", "SF", "F"])]]);
    const played = new Map([["tX", 5]]);
    expect(bracketSurvivalOf("tX", won, played, ladder)).toEqual({ value: 1, sample: 5 });
  });
  it("champion eliminated in the QF scores 2/5", () => {
    const won = new Map([["tX", new Set(["R32", "R16"])]]);
    const played = new Map([["tX", 3]]); // won R32, R16, lost QF
    expect(bracketSurvivalOf("tX", won, played, ladder)).toEqual({ value: 0.4, sample: 3 });
  });
});

describe("computeBoldness", () => {
  it("flags a pick shared by < 25% of the cohort", () => {
    // match m1: 5 cohort picks — user picked DRAW which only the user made (1/5 = 20% < 25%) → bold
    const rows = [
      { user_id: "u1", pick: "DRAW" as const, match_id: "m1", match: null },
      { user_id: "u2", pick: "HOME" as const, match_id: "m1", match: null },
      { user_id: "u3", pick: "HOME" as const, match_id: "m1", match: null },
      { user_id: "u4", pick: "HOME" as const, match_id: "m1", match: null },
      { user_id: "u5", pick: "AWAY" as const, match_id: "m1", match: null },
    ];
    expect(computeBoldness(rows, "u1", 0.25)).toEqual({ pct: 100, sample: 1 });
  });
  it("returns null when the cohort is just the user (no consensus)", () => {
    const rows = [{ user_id: "u1", pick: "HOME" as const, match_id: "m1", match: null }];
    expect(computeBoldness(rows, "u1", 0.25)).toEqual({ pct: null, sample: 0 });
  });
});

describe("avgPickLead", () => {
  it("averages positive leads and discards picks submitted after kickoff", () => {
    const rows = [
      { pick: "HOME" as const, submitted_at: "2026-06-10T20:00:00Z", match: groupMatch("SCHEDULED", null, "t1", "t2", "2026-06-11T20:00:00Z") }, // 1 day
      { pick: "HOME" as const, submitted_at: "2026-06-09T20:00:00Z", match: groupMatch("SCHEDULED", null, "t1", "t2", "2026-06-12T20:00:00Z") }, // 3 days
      { pick: "HOME" as const, submitted_at: "2026-06-20T20:00:00Z", match: groupMatch("SCHEDULED", null, "t1", "t2", "2026-06-11T20:00:00Z") }, // negative → discarded
    ];
    const lead = avgPickLead(rows);
    expect(lead.days).toBeCloseTo(2, 5); // mean(1, 3)
  });
  it("returns null with no usable rows", () => {
    expect(avgPickLead([])).toEqual({ hours: null, days: null });
  });
});

describe("countUpsets", () => {
  const ranks = new Map<string, number | null>([
    ["strong", 3],
    ["weak", 30],
    ["mid", 6],
    ["norank", null],
  ]);
  it("counts a correct pick where the winner is >= margin ranks worse", () => {
    const rows = [
      { pick: "HOME" as const, submitted_at: "", match: groupMatch("FINISHED", "HOME", "weak", "strong") }, // weak (30) beat strong (3) → upset
    ];
    expect(countUpsets(rows, ranks, 5)).toBe(1);
  });
  it("does not count a near-equal upset below the margin", () => {
    const rows = [
      { pick: "HOME" as const, submitted_at: "", match: groupMatch("FINISHED", "HOME", "mid", "strong") }, // 6 vs 3 → gap 3 < 5
    ];
    expect(countUpsets(rows, ranks, 5)).toBe(0);
  });
  it("never counts a DRAW as an upset", () => {
    const rows = [
      { pick: "DRAW" as const, submitted_at: "", match: groupMatch("FINISHED", "DRAW", "weak", "strong") },
    ];
    expect(countUpsets(rows, ranks, 5)).toBe(0);
  });
  it("degrades to null when no correct pick has both ranks", () => {
    const rows = [
      { pick: "HOME" as const, submitted_at: "", match: groupMatch("FINISHED", "HOME", "norank", "strong") },
    ];
    expect(countUpsets(rows, ranks, 5)).toBeNull();
  });
});

describe("presentLadder / KO maps", () => {
  it("keeps only present rounds in ladder order", () => {
    const matches = [ko("QF", "QF-A", "FINISHED", "HOME", "a", "b"), ko("R16", "R16-1", "FINISHED", "AWAY", "c", "d")];
    expect(presentLadder(matches)).toEqual(["R16", "QF"]);
  });
  it("tracks wins and games played from finished matches", () => {
    const matches = [ko("R16", "R16-1", "FINISHED", "HOME", "a", "b"), ko("QF", "QF-A", "SCHEDULED", null, "a", "c")];
    expect(buildStagesWonByTeam(matches).get("a")).toEqual(new Set(["R16"]));
    expect(buildPlayedCountByTeam(matches).get("a")).toBe(1); // only the finished R16
  });
});

describe("computePersonality (integration)", () => {
  it("assembles pick-mix, comparisons and secondary stats", () => {
    const input: PersonalityInput = {
      ...EMPTY,
      ownMatchPicks: [
        { pick: "HOME", submitted_at: "2026-06-10T20:00:00Z", match: groupMatch("FINISHED", "HOME", "weak", "strong") }, // correct + upset
        { pick: "AWAY", submitted_at: "2026-06-10T20:00:00Z", match: groupMatch("FINISHED", "HOME", "t1", "t2") }, // wrong
        { pick: "DRAW", submitted_at: "2026-06-10T20:00:00Z", match: groupMatch("SCHEDULED", null) },
      ],
      ranksByTeam: new Map<string, number | null>([
        ["weak", 40],
        ["strong", 2],
      ]),
      cohortMatchPicks: [
        // m1: user DRAW alone among 5 → 1/5 = 20% < 25% → bold
        { user_id: "u1", pick: "DRAW", match_id: "m1", match: { stage: "GROUP", status: "FINISHED", winner: "HOME" } },
        { user_id: "u2", pick: "HOME", match_id: "m1", match: { stage: "GROUP", status: "FINISHED", winner: "HOME" } },
        { user_id: "u3", pick: "HOME", match_id: "m1", match: { stage: "GROUP", status: "FINISHED", winner: "HOME" } },
        { user_id: "u4", pick: "HOME", match_id: "m1", match: { stage: "GROUP", status: "FINISHED", winner: "HOME" } },
        { user_id: "u5", pick: "AWAY", match_id: "m1", match: { stage: "GROUP", status: "FINISHED", winner: "HOME" } },
      ],
      cohortIds: ["u1", "u2", "u3", "u4", "u5"],
      leagueCount: 1,
      isSelf: true,
    };
    const p = computePersonality(input);
    expect(p.pickMix.total).toBe(3);
    expect(p.pickMix.pct!.home + p.pickMix.pct!.draw + p.pickMix.pct!.away).toBe(100);
    expect(p.groupAccuracy.userValue).toBe(0.5); // 1 correct of 2 finished
    expect(p.groupAccuracy.userSample).toBe(2);
    expect(p.upsetsCalled).toBe(1);
    expect(p.boldnessPct).toBe(100); // the one usable pick (m1) was bold
    expect(p.soloCohort).toBe(false);
  });

  it("returns null comparisons and suppresses boldness for a solo cohort", () => {
    const p = computePersonality({
      ...EMPTY,
      ownMatchPicks: [{ pick: "HOME", submitted_at: "2026-06-10T20:00:00Z", match: groupMatch("SCHEDULED", null) }],
      cohortIds: ["u1"],
      leagueCount: 1,
    });
    expect(p.pickMix.total).toBe(1);
    expect(p.groupAccuracy.cohortAvg).toBeNull();
    expect(p.boldnessPct).toBeNull();
    expect(p.soloCohort).toBe(true);
  });
});
