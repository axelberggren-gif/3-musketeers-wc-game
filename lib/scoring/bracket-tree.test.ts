import { describe, it, expect } from "vitest";
import {
  BRACKET_UPSTREAM,
  upstreamSlots,
  knockoutSlotByFeeders,
  r32SlotForMatchup,
  R32_MATCHUP_SLOT,
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

  // The official WC 2026 bracket pairs NON-adjacent kickoff-ordered R32 slots
  // into each R16 match (slots = Matches 73..88; R16-n = Match 88+n). See the
  // BRACKET_UPSTREAM comment for the source grid.
  it("R16 feeds match the official FIFA WC 2026 bracket", () => {
    expect(upstreamSlots("R16-1")).toEqual(["R32-2", "R32-5"]); // M89: W74 vs W77
    expect(upstreamSlots("R16-2")).toEqual(["R32-1", "R32-3"]); // M90: W73 vs W75
    expect(upstreamSlots("R16-3")).toEqual(["R32-4", "R32-6"]); // M91: W76 vs W78
    expect(upstreamSlots("R16-4")).toEqual(["R32-7", "R32-8"]); // M92: W79 vs W80
    expect(upstreamSlots("R16-5")).toEqual(["R32-11", "R32-12"]); // M93: W83 vs W84
    expect(upstreamSlots("R16-6")).toEqual(["R32-9", "R32-10"]); // M94: W81 vs W82
    expect(upstreamSlots("R16-7")).toEqual(["R32-14", "R32-16"]); // M95: W86 vs W88
    expect(upstreamSlots("R16-8")).toEqual(["R32-13", "R32-15"]); // M96: W85 vs W87
  });

  it("QF feeds match the official FIFA WC 2026 bracket", () => {
    expect(upstreamSlots("QF-A")).toEqual(["R16-1", "R16-2"]); // M97
    expect(upstreamSlots("QF-B")).toEqual(["R16-5", "R16-6"]); // M98
    expect(upstreamSlots("QF-C")).toEqual(["R16-3", "R16-4"]); // M99
    expect(upstreamSlots("QF-D")).toEqual(["R16-7", "R16-8"]); // M100
  });

  it("SF/F/W chain through", () => {
    expect(upstreamSlots("SF-A")).toEqual(["QF-A", "QF-B"]);
    expect(upstreamSlots("SF-B")).toEqual(["QF-C", "QF-D"]);
    expect(upstreamSlots("F")).toEqual(["SF-A", "SF-B"]);
    expect(upstreamSlots("W")).toEqual(["F"]);
  });

  // Guard the property that makes the bug ("Norway vs France in the R16")
  // impossible: every team that can reach a given slot does so through exactly
  // one path, and the two halves of the draw only meet in the Final.
  it("no R32 slot feeds two different R16 slots (each match has one downstream)", () => {
    const downstreamCount = new Map<string, number>();
    for (const ups of Object.values(BRACKET_UPSTREAM)) {
      for (const up of ups) downstreamCount.set(up, (downstreamCount.get(up) ?? 0) + 1);
    }
    for (let i = 1; i <= 16; i++) expect(downstreamCount.get(`R32-${i}`)).toBe(1);
  });

  it("each R16 slot's two feeders are distinct and every R32 slot is used once", () => {
    const allFeeders = [
      ...Array.from({ length: 8 }, (_, i) => upstreamSlots(`R16-${i + 1}`)),
    ].flat();
    expect(new Set(allFeeders).size).toBe(16); // all distinct
    for (let i = 1; i <= 16; i++) expect(allFeeders).toContain(`R32-${i}`);
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

describe("knockoutSlotByFeeders", () => {
  it("inverts BRACKET_UPSTREAM to the canonical R16 slot (order-independent)", () => {
    expect(knockoutSlotByFeeders("R32-2", "R32-5")).toBe("R16-1");
    expect(knockoutSlotByFeeders("R32-5", "R32-2")).toBe("R16-1"); // order ignored
    expect(knockoutSlotByFeeders("R32-1", "R32-3")).toBe("R16-2");
    expect(knockoutSlotByFeeders("R32-13", "R32-15")).toBe("R16-8");
  });

  it("resolves QF and SF slots from their feeders", () => {
    expect(knockoutSlotByFeeders("R16-1", "R16-2")).toBe("QF-A");
    expect(knockoutSlotByFeeders("R16-7", "R16-8")).toBe("QF-D");
    expect(knockoutSlotByFeeders("QF-A", "QF-B")).toBe("SF-A");
    expect(knockoutSlotByFeeders("QF-C", "QF-D")).toBe("SF-B");
  });

  it("returns null for a pair that feeds no slot", () => {
    expect(knockoutSlotByFeeders("R32-1", "R32-2")).toBeNull(); // not a real feed pair
    expect(knockoutSlotByFeeders("R16-1", "R16-8")).toBeNull();
    expect(knockoutSlotByFeeders("QF-A", "QF-C")).toBeNull();
  });

  it("round-trips every multi-feeder slot through its own feeders", () => {
    for (const [slot, ups] of Object.entries(BRACKET_UPSTREAM)) {
      if (ups.length === 2) {
        expect(knockoutSlotByFeeders(ups[0], ups[1])).toBe(slot);
      }
    }
  });
});

describe("r32SlotForMatchup", () => {
  it("pins the France–Sweden tie to R32-5 and Netherlands–Morocco to R32-3", () => {
    // The bug was these landing in the same R16; correct slots put them in
    // different R16s (R32-5 → R16-1, R32-3 → R16-2), meeting earliest in the QF.
    expect(r32SlotForMatchup("FRA", "SWE")).toBe("R32-5");
    expect(r32SlotForMatchup("NED", "MAR")).toBe("R32-3");
    expect(knockoutSlotByFeeders("R32-2", "R32-5")).toBe("R16-1"); // France's R16
    expect(knockoutSlotByFeeders("R32-1", "R32-3")).toBe("R16-2"); // Morocco's R16
  });

  it("is order-independent", () => {
    expect(r32SlotForMatchup("SWE", "FRA")).toBe("R32-5");
    expect(r32SlotForMatchup("CAN", "RSA")).toBe(r32SlotForMatchup("RSA", "CAN"));
  });

  it("returns null for unknown / partial matchups", () => {
    expect(r32SlotForMatchup("FRA", "BRA")).toBeNull(); // not a real R32 tie
    expect(r32SlotForMatchup("FRA", null)).toBeNull();
    expect(r32SlotForMatchup(null, null)).toBeNull();
  });

  it("maps all 16 ties to a unique R32-1..16 slot", () => {
    const slots = Object.values(R32_MATCHUP_SLOT);
    expect(slots).toHaveLength(16);
    expect(new Set(slots).size).toBe(16); // no duplicate slots
    expect(new Set(slots)).toEqual(
      new Set(Array.from({ length: 16 }, (_, i) => `R32-${i + 1}`)),
    );
  });

  it("keys are stored as sorted code pairs", () => {
    for (const key of Object.keys(R32_MATCHUP_SLOT)) {
      const [a, b] = key.split("/");
      expect([a, b]).toEqual([a, b].sort());
    }
  });
});
