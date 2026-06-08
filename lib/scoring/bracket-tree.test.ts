import { describe, it, expect } from "vitest";
import {
  upstreamSlots,
  predictedGroupStandings,
  suggestR32Qualifiers,
  filterSuggestionsByMatchPairs,
  computeGroupFinals,
  qualSourceLabel,
  slotFriendlyName,
  R32_QUALIFIERS,
  type GroupMatch,
  type RealGroupMatch,
} from "./bracket-tree";

describe("upstreamSlots", () => {
  it("R32 slots have no upstream", () => {
    expect(upstreamSlots("R32-1")).toEqual([]);
    expect(upstreamSlots("R32-16")).toEqual([]);
  });

  it("R16-N feeds from R32-(2N-1) and R32-2N", () => {
    expect(upstreamSlots("R16-1")).toEqual(["R32-1", "R32-2"]);
    expect(upstreamSlots("R16-8")).toEqual(["R32-15", "R32-16"]);
  });

  it("QF-A..D pair adjacent R16 slots", () => {
    expect(upstreamSlots("QF-A")).toEqual(["R16-1", "R16-2"]);
    expect(upstreamSlots("QF-D")).toEqual(["R16-7", "R16-8"]);
  });

  it("SF/F/W chain through", () => {
    expect(upstreamSlots("SF-A")).toEqual(["QF-A", "QF-B"]);
    expect(upstreamSlots("SF-B")).toEqual(["QF-C", "QF-D"]);
    expect(upstreamSlots("F")).toEqual(["SF-A", "SF-B"]);
    expect(upstreamSlots("W")).toEqual(["F"]);
  });
});

describe("predictedGroupStandings", () => {
  const matches: GroupMatch[] = [
    { id: "m1", group_letter: "A", home_team_id: "t1", away_team_id: "t2" },
    { id: "m2", group_letter: "A", home_team_id: "t1", away_team_id: "t3" },
    { id: "m3", group_letter: "A", home_team_id: "t2", away_team_id: "t3" },
  ];

  it("awards 3/1/0 from match picks", () => {
    const standings = predictedGroupStandings(matches, {
      m1: "HOME",
      m2: "DRAW",
      m3: "AWAY",
    });
    const byTeam = Object.fromEntries(standings.map((s) => [s.teamId, s]));
    expect(byTeam.t1.points).toBe(4);
    expect(byTeam.t2.points).toBe(0);
    expect(byTeam.t3.points).toBe(4);
  });

  it("skips matches without a pick", () => {
    const standings = predictedGroupStandings(matches, { m1: "HOME" });
    const byTeam = Object.fromEntries(standings.map((s) => [s.teamId, s]));
    expect(byTeam.t1.points).toBe(3);
    expect(byTeam.t1.played).toBe(1);
    expect(byTeam.t3.played).toBe(0);
  });

  it("ignores matches missing teams or group letter", () => {
    const partial: GroupMatch[] = [
      { id: "m4", group_letter: null, home_team_id: "t1", away_team_id: "t2" },
      { id: "m5", group_letter: "B", home_team_id: null, away_team_id: "t9" },
    ];
    const standings = predictedGroupStandings(partial, { m4: "HOME", m5: "HOME" });
    expect(standings).toEqual([]);
  });
});

describe("suggestR32Qualifiers", () => {
  it("never returns more than 16 picks (one per R32 match slot)", () => {
    const standings: { teamId: string; groupLetter: string; points: number; played: number }[] = [];
    const names: Record<string, string> = {};
    for (const letter of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]) {
      for (let i = 1; i <= 4; i++) {
        const id = `${letter}${i}`;
        standings.push({ teamId: id, groupLetter: letter, points: 12 - i * 3, played: 3 });
        names[id] = id;
      }
    }
    const qualifiers = suggestR32Qualifiers(standings, names);
    expect(qualifiers).toHaveLength(16);
    for (const q of qualifiers) {
      const n = Number(q.slot.split("-")[1]);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(16);
    }
  });

  it("ranks top advancers by points across all groups", () => {
    const standings = [
      { teamId: "A1", groupLetter: "A", points: 9, played: 3 },
      { teamId: "A2", groupLetter: "A", points: 6, played: 3 },
      { teamId: "A3", groupLetter: "A", points: 3, played: 3 },
      { teamId: "B1", groupLetter: "B", points: 7, played: 3 },
      { teamId: "B2", groupLetter: "B", points: 5, played: 3 },
      { teamId: "B3", groupLetter: "B", points: 4, played: 3 },
    ];
    const qualifiers = suggestR32Qualifiers(standings, {
      A1: "A1",
      A2: "A2",
      A3: "A3",
      B1: "B1",
      B2: "B2",
      B3: "B3",
    });
    const bySlot = Object.fromEntries(qualifiers.map((q) => [q.slot, q.teamId]));
    expect(bySlot["R32-1"]).toBe("A1");
    expect(bySlot["R32-2"]).toBe("B1");
    expect(bySlot["R32-3"]).toBe("A2");
    expect(bySlot["R32-4"]).toBe("B2");
    expect(qualifiers.find((q) => q.teamId === "A3")).toBeUndefined();
    expect(qualifiers.find((q) => q.teamId === "B3")).toBeUndefined();
  });

  it("breaks ties alphabetically by team name", () => {
    const standings = [
      { teamId: "tx", groupLetter: "A", points: 6, played: 3 },
      { teamId: "ty", groupLetter: "A", points: 6, played: 3 },
    ];
    const qualifiers = suggestR32Qualifiers(standings, { tx: "Zebra", ty: "Alpha" });
    const bySlot = Object.fromEntries(qualifiers.map((q) => [q.slot, q.teamId]));
    expect(bySlot["R32-1"]).toBe("ty");
    expect(bySlot["R32-2"]).toBe("tx");
  });
});

describe("filterSuggestionsByMatchPairs", () => {
  it("passes everything through when no slot matches are known", () => {
    const suggestions = [
      { slot: "R32-1", teamId: "brazil" },
      { slot: "R32-2", teamId: "spain" },
    ];
    expect(filterSuggestionsByMatchPairs(suggestions, {})).toEqual(suggestions);
  });

  it("keeps a suggestion when its team is one of the match's two teams", () => {
    const suggestions = [
      { slot: "R32-1", teamId: "brazil" },
      { slot: "R32-2", teamId: "spain" },
    ];
    const slotMatches = {
      "R32-1": { homeTeamId: "brazil", awayTeamId: "mexico" },
      "R32-2": { homeTeamId: "germany", awayTeamId: "spain" },
    };
    expect(filterSuggestionsByMatchPairs(suggestions, slotMatches)).toEqual(suggestions);
  });

  it("drops a suggestion whose team is neither side of the match", () => {
    const suggestions = [
      { slot: "R32-1", teamId: "brazil" },
      { slot: "R32-2", teamId: "spain" },
    ];
    const slotMatches = {
      "R32-1": { homeTeamId: "argentina", awayTeamId: "mexico" },
      "R32-2": { homeTeamId: "germany", awayTeamId: "spain" },
    };
    const filtered = filterSuggestionsByMatchPairs(suggestions, slotMatches);
    expect(filtered).toEqual([{ slot: "R32-2", teamId: "spain" }]);
  });

  it("leaves a suggestion untouched if its slot has no real match yet", () => {
    const suggestions = [{ slot: "R32-5", teamId: "argentina" }];
    const slotMatches = {
      "R32-1": { homeTeamId: "brazil", awayTeamId: "mexico" },
    };
    expect(filterSuggestionsByMatchPairs(suggestions, slotMatches)).toEqual(suggestions);
  });
});

describe("R32_QUALIFIERS", () => {
  it("covers all 16 R32 slots with two sides each", () => {
    for (let i = 1; i <= 16; i++) {
      const sides = R32_QUALIFIERS[`R32-${i}`];
      expect(sides, `R32-${i}`).toBeDefined();
      expect(sides).toHaveLength(2);
    }
  });

  it("matches the official schedule for sampled matches", () => {
    // M73: Runner-up A vs Runner-up B
    expect(R32_QUALIFIERS["R32-1"]).toEqual([
      { kind: "runnerup", group: "A" },
      { kind: "runnerup", group: "B" },
    ]);
    // M74: Winner E vs 3rd of A/B/C/D/F
    expect(R32_QUALIFIERS["R32-2"]).toEqual([
      { kind: "winner", group: "E" },
      { kind: "third", groups: ["A", "B", "C", "D", "F"] },
    ]);
    // M76: Winner C vs Runner-up F
    expect(R32_QUALIFIERS["R32-4"]).toEqual([
      { kind: "winner", group: "C" },
      { kind: "runnerup", group: "F" },
    ]);
  });
});

describe("qualSourceLabel", () => {
  it("labels winners, runners-up and thirds", () => {
    expect(qualSourceLabel({ kind: "winner", group: "A" })).toBe("Winner Group A");
    expect(qualSourceLabel({ kind: "runnerup", group: "K" })).toBe("Runner-up Group K");
    expect(qualSourceLabel({ kind: "third", groups: ["A", "B", "C", "D", "F"] })).toBe(
      "3rd Group A/B/C/D/F",
    );
  });
});

describe("slotFriendlyName", () => {
  it("names knockout rounds with a 1-based index", () => {
    expect(slotFriendlyName("QF-A")).toBe("Quarter-final 1");
    expect(slotFriendlyName("QF-D")).toBe("Quarter-final 4");
    expect(slotFriendlyName("SF-B")).toBe("Semi-final 2");
    expect(slotFriendlyName("R16-3")).toBe("Round of 16 #3");
    expect(slotFriendlyName("R32-12")).toBe("Round of 32 #12");
    expect(slotFriendlyName("F")).toBe("Final");
  });
});

describe("computeGroupFinals", () => {
  // A minimal 3-team group (3 matches) so a full round-robin is easy to express.
  const group = (
    rows: Array<[string, string, number | null, number | null, string]>,
  ): RealGroupMatch[] =>
    rows.map(([h, a, hs, as_, status]) => ({
      group_letter: "A",
      home_team_id: h,
      away_team_id: a,
      home_score: hs,
      away_score: as_,
      status,
    }));

  it("leaves a group unresolved until every match is FINISHED", () => {
    const finals = computeGroupFinals(
      group([
        ["x", "y", 1, 0, "FINISHED"],
        ["x", "z", null, null, "SCHEDULED"],
        ["y", "z", null, null, "SCHEDULED"],
      ]),
    );
    expect(finals.A).toEqual({ winnerTeamId: null, runnerUpTeamId: null, complete: false });
  });

  it("ranks a completed group by points then goal difference", () => {
    const finals = computeGroupFinals(
      group([
        ["x", "y", 2, 0, "FINISHED"], // x +2
        ["y", "z", 1, 0, "FINISHED"], // y beats z
        ["x", "z", 1, 1, "FINISHED"], // x draws z
      ]),
    );
    // x: 3+1=4 pts; y: 3 pts; z: 1 pt → winner x, runner-up y
    expect(finals.A.complete).toBe(true);
    expect(finals.A.winnerTeamId).toBe("x");
    expect(finals.A.runnerUpTeamId).toBe("y");
  });

  it("breaks a points tie on goal difference", () => {
    const finals = computeGroupFinals(
      group([
        ["x", "y", 3, 0, "FINISHED"], // x big win
        ["y", "z", 1, 0, "FINISHED"], // y beats z
        ["z", "x", 1, 0, "FINISHED"], // z beats x
      ]),
    );
    // 3 pts each; GD: x +2, z 0, y -2 → x wins on goal difference
    expect(finals.A.complete).toBe(true);
    expect(finals.A.winnerTeamId).toBe("x");
  });
});
