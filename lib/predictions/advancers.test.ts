import { describe, expect, it } from "vitest";
import {
  aggregateGroupStats,
  deriveAdvancers,
  sortGroup,
  type GroupMatchInput,
  type Pick,
  type PickInput,
  type TeamInput,
} from "./advancers";

// Helper: build a group of 4 teams (A, B, C, D) with all 6 matches between them.
// Match IDs are deterministic so picks can reference them.
function mkGroup(group_letter: string, teamIds: [string, string, string, string]): GroupMatchInput[] {
  const [t1, t2, t3, t4] = teamIds;
  return [
    { id: `${group_letter}-1`, home_team_id: t1, away_team_id: t2, group_letter },
    { id: `${group_letter}-2`, home_team_id: t3, away_team_id: t4, group_letter },
    { id: `${group_letter}-3`, home_team_id: t1, away_team_id: t3, group_letter },
    { id: `${group_letter}-4`, home_team_id: t2, away_team_id: t4, group_letter },
    { id: `${group_letter}-5`, home_team_id: t1, away_team_id: t4, group_letter },
    { id: `${group_letter}-6`, home_team_id: t2, away_team_id: t3, group_letter },
  ];
}

function mkPicks(picks: Record<string, Pick>): PickInput[] {
  return Object.entries(picks).map(([match_id, pick]) => ({ match_id, pick }));
}

describe("aggregateGroupStats", () => {
  it("sums points / wins / draws across one group's matches", () => {
    const matches = mkGroup("A", ["t1", "t2", "t3", "t4"]);
    // t1 wins all 3 → 9pts; t2 draws all 3 → 3pts; t3 loses all → 0; t4 mixed
    const picks = new Map<string, Pick>([
      ["A-1", "1"], // t1 beats t2 (home wins)
      ["A-3", "1"], // t1 beats t3
      ["A-5", "1"], // t1 beats t4
      ["A-4", "X"], // t2 draws t4
      ["A-6", "X"], // t2 draws t3
      ["A-2", "1"], // t3 beats t4 (home wins) — t4 picked-loss already x2
    ]);
    const stats = aggregateGroupStats(matches, picks);
    expect(stats.get("t1")).toMatchObject({ points: 9, wins: 3, matches_played: 3 });
    // t2: lost to t1, drew t4, drew t3 → 2pts, 0W 2D
    expect(stats.get("t2")).toMatchObject({ points: 2, wins: 0, draws: 2, matches_played: 3 });
    // t3: lost to t1, drew t2, won vs t4 → 4pts, 1W 1D
    expect(stats.get("t3")).toMatchObject({ points: 4, wins: 1, draws: 1, matches_played: 3 });
    // t4: lost to t1, drew t2, lost to t3 → 1pt, 0W 1D
    expect(stats.get("t4")).toMatchObject({ points: 1, wins: 0, draws: 1, matches_played: 3 });
  });

  it("ignores matches with no pick", () => {
    const matches = mkGroup("A", ["t1", "t2", "t3", "t4"]);
    const picks = new Map<string, Pick>([["A-1", "1"]]);
    const stats = aggregateGroupStats(matches, picks);
    expect(stats.get("t1")?.matches_played).toBe(1);
    expect(stats.get("t1")?.points).toBe(3);
    expect(stats.get("t3")).toBeUndefined();
  });
});

describe("sortGroup", () => {
  it("sorts by points desc when no ties", () => {
    const matches = mkGroup("A", ["t1", "t2", "t3", "t4"]);
    const picks = new Map<string, Pick>([
      ["A-1", "1"], ["A-3", "1"], ["A-5", "1"], // t1 wins all
      ["A-4", "1"], ["A-6", "1"], // t2 wins 2
      ["A-2", "1"], // t3 wins 1
    ]);
    const rawStats = Array.from(aggregateGroupStats(matches, picks).values());
    const { sorted, warnings } = sortGroup("A", rawStats, matches, picks, new Map());
    expect(sorted.map((s) => s.team_id)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(warnings).toHaveLength(0);
    expect(sorted.every((s) => s.tiebreaker === null)).toBe(true);
  });

  it("breaks ties on head-to-head pick", () => {
    const matches = mkGroup("A", ["t1", "t2", "t3", "t4"]);
    // t1 and t2 both 6pts (each won 2), but t1 beat t2 head-to-head.
    const picks = new Map<string, Pick>([
      ["A-1", "1"], // t1 beats t2 ← decisive H2H
      ["A-3", "1"], // t1 beats t3
      ["A-5", "2"], // t4 beats t1 (so t1 has 6pts: 2W, 1L)
      ["A-4", "1"], // t2 beats t4
      ["A-6", "1"], // t2 beats t3 (so t2 has 6pts: 2W, 1L)
      ["A-2", "1"], // t3 beats t4
    ]);
    const rawStats = Array.from(aggregateGroupStats(matches, picks).values());
    const { sorted } = sortGroup("A", rawStats, matches, picks, new Map());
    expect(sorted[0].team_id).toBe("t1");
    expect(sorted[1].team_id).toBe("t2");
    expect(sorted[1].tiebreaker).toBe("head_to_head");
  });

  it("falls back to FIFA rank when head-to-head is a draw", () => {
    const matches = mkGroup("A", ["t1", "t2", "t3", "t4"]);
    // t1 and t2 tied on points, drew H2H. t2 has lower (better) FIFA rank.
    const picks = new Map<string, Pick>([
      ["A-1", "X"], // t1 vs t2 drew
      ["A-3", "1"], // t1 beats t3
      ["A-5", "1"], // t1 beats t4
      ["A-4", "1"], // t2 beats t4
      ["A-6", "1"], // t2 beats t3
      ["A-2", "1"], // t3 beats t4
    ]);
    // t1 = 7pts (2W 1D), t2 = 7pts (2W 1D) — tied. Drew H2H. Rank decides.
    const fifaRanks = new Map<string, number | null>([
      ["t1", 20],
      ["t2", 5], // better
      ["t3", 30],
      ["t4", 40],
    ]);
    const rawStats = Array.from(aggregateGroupStats(matches, picks).values());
    const { sorted, warnings } = sortGroup("A", rawStats, matches, picks, fifaRanks);
    expect(sorted[0].team_id).toBe("t2");
    expect(sorted[1].team_id).toBe("t1");
    expect(sorted[1].tiebreaker).toBe("fifa_ranking");
    expect(warnings.some((w) => w.includes("FIFA rank"))).toBe(true);
  });

  it("marks tiebreaker 'unresolved' when neither H2H nor FIFA rank can decide", () => {
    const matches = mkGroup("A", ["t1", "t2", "t3", "t4"]);
    const picks = new Map<string, Pick>([
      ["A-1", "X"], // t1 vs t2 drew (no H2H winner)
      ["A-3", "1"], ["A-5", "1"],
      ["A-4", "1"], ["A-6", "1"],
      ["A-2", "1"],
    ]);
    // No FIFA ranks supplied for tied teams.
    const rawStats = Array.from(aggregateGroupStats(matches, picks).values());
    const { sorted, warnings } = sortGroup("A", rawStats, matches, picks, new Map());
    expect(sorted[1].tiebreaker).toBe("unresolved");
    expect(warnings.some((w) => w.includes("no tiebreaker"))).toBe(true);
  });
});

describe("deriveAdvancers", () => {
  it("returns 12 winners, 12 runners-up, 8 best 3rds across 12 groups", () => {
    // Build 12 groups with deterministic distinct standings (no ties)
    const groups = "ABCDEFGHIJKL".split("");
    const matches: GroupMatchInput[] = [];
    const picksObj: Record<string, Pick> = {};
    const teams: TeamInput[] = [];

    for (let g = 0; g < groups.length; g++) {
      const letter = groups[g];
      const teamIds: [string, string, string, string] = [
        `${letter}-team1`,
        `${letter}-team2`,
        `${letter}-team3`,
        `${letter}-team4`,
      ];
      teamIds.forEach((id, idx) => {
        // Higher group index → worse FIFA rank for the 3rd-place team, so we
        // can predict the bestThirds order in the assertion below.
        teams.push({ id, fifa_ranking: g * 4 + idx + 1 });
      });
      const gm = mkGroup(letter, teamIds);
      matches.push(...gm);
      // Make team1 win all 3 (9pts), team2 win 2 (6pts), team3 win 1 (3pts),
      // team4 loses everything. Clear standings: team1 > team2 > team3 > team4.
      picksObj[`${letter}-1`] = "1"; // t1 v t2 → t1 wins (home)
      picksObj[`${letter}-3`] = "1"; // t1 v t3 → t1 wins
      picksObj[`${letter}-5`] = "1"; // t1 v t4 → t1 wins
      picksObj[`${letter}-4`] = "1"; // t2 v t4 → t2 wins (home)
      picksObj[`${letter}-6`] = "1"; // t2 v t3 → t2 wins
      picksObj[`${letter}-2`] = "1"; // t3 v t4 → t3 wins (home)
    }

    const result = deriveAdvancers(matches, mkPicks(picksObj), teams);

    expect(result.winners).toHaveLength(12);
    expect(result.runnersUp).toHaveLength(12);
    expect(result.bestThirds).toHaveLength(8);
    // All 12 3rd-places have 3pts → cut-off (8th vs 9th) tied → 1 warning.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Best 3rd-place");

    // Winners: every "letter-team1" with 9 pts.
    for (let i = 0; i < 12; i++) {
      expect(result.winners[i].team_id).toBe(`${groups[i]}-team1`);
      expect(result.winners[i].points).toBe(9);
    }
    // All 12 3rd-places have 3pts → tied. Best 8 picked by FIFA rank.
    expect(result.bestThirds.every((t) => t.points === 3)).toBe(true);
  });

  it("handles a user who hasn't picked any matches yet", () => {
    const groups = "ABCDEFGHIJKL".split("");
    const matches: GroupMatchInput[] = [];
    const teams: TeamInput[] = [];
    for (const letter of groups) {
      const teamIds: [string, string, string, string] = [
        `${letter}-t1`, `${letter}-t2`, `${letter}-t3`, `${letter}-t4`,
      ];
      teamIds.forEach((id, i) => teams.push({ id, fifa_ranking: i + 1 }));
      matches.push(...mkGroup(letter, teamIds));
    }
    const result = deriveAdvancers(matches, [], teams);
    // No picks → aggregateGroupStats returns empty → no advancers emitted.
    // UI should render an empty-state message rather than partial data.
    expect(result.winners).toHaveLength(0);
    expect(result.runnersUp).toHaveLength(0);
    expect(result.bestThirds).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("processes groups alphabetically (A first, L last)", () => {
    const teams: TeamInput[] = [];
    const matches: GroupMatchInput[] = [];
    const picksObj: Record<string, Pick> = {};
    for (const letter of ["L", "B", "A"]) {
      const teamIds: [string, string, string, string] = [
        `${letter}-t1`, `${letter}-t2`, `${letter}-t3`, `${letter}-t4`,
      ];
      teamIds.forEach((id, i) => teams.push({ id, fifa_ranking: i + 1 }));
      matches.push(...mkGroup(letter, teamIds));
      picksObj[`${letter}-1`] = "1";
    }
    const result = deriveAdvancers(matches, mkPicks(picksObj), teams);
    // Winners list should be ordered A, B, L (alphabetical), not insertion order.
    expect(result.winners.map((w) => w.group_letter)).toEqual(["A", "B", "L"]);
  });
});
