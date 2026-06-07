import { describe, expect, it } from "vitest";
import {
  BEST_THIRDS_ADVANCING,
  firstEliminatedTeamId,
  isEliminatedFromTournament,
  maxReachablePoints,
  type GroupStageTeam,
} from "./first-eliminated";

// Mirror of the SQL score_first_eliminated() in
// supabase/migrations/0017_fix_first_eliminated_48team.sql. These cover the
// WC 2026 48-team format gap from issue #81: being out of the group top-2 is
// NOT elimination, because the 8 best third-placed teams also advance.

const LETTERS = "ABCDEFGHIJKL".split(""); // 12 groups

/** Build one 4-team group, fully played (3 games each) unless overridden. */
function group(
  letter: string,
  ptsArray: [number, number, number, number],
  opts: { gamesPlayed?: number; gamesTotal?: number; lastFinishedAt?: number } = {},
): GroupStageTeam[] {
  const { gamesPlayed = 3, gamesTotal = 3, lastFinishedAt = 1000 } = opts;
  return ptsArray.map((pts, i) => ({
    teamId: `${letter}${i + 1}`,
    groupLetter: letter,
    pts,
    gamesPlayed,
    gamesTotal,
    lastFinishedAt,
  }));
}

/** N groups (from the start of LETTERS) all with the same fully-played pts shape. */
function fillGroups(n: number, ptsArray: [number, number, number, number]): GroupStageTeam[] {
  return LETTERS.slice(0, n).flatMap((l) => group(l, ptsArray));
}

describe("maxReachablePoints", () => {
  it("adds 3 per remaining game", () => {
    expect(
      maxReachablePoints({
        teamId: "x",
        groupLetter: "A",
        pts: 1,
        gamesPlayed: 2,
        gamesTotal: 3,
        lastFinishedAt: 0,
      }),
    ).toBe(4);
  });
});

describe("isEliminatedFromTournament — group top-2 / best-third interaction", () => {
  it("does NOT flag a team that drops to 3rd but can still be a best-third", () => {
    // Group A after round 2 (1 game left): A3 is 3rd with ceiling 3, beaten by
    // A1 & A2 (6 pts) but not yet out of the thirds race.
    const groupA = group("A", [6, 6, 0, 0], { gamesPlayed: 2, gamesTotal: 3 });
    const a3 = groupA.find((t) => t.teamId === "A3")!;
    // 11 other groups, all weak (third floor 0 ≤ A3's ceiling of 3).
    const others = LETTERS.slice(1, 12).flatMap((l) => group(l, [3, 3, 0, 0]));
    const all = [...groupA, ...others];

    expect(isEliminatedFromTournament(a3, all)).toBe(false);
    expect(firstEliminatedTeamId(all)).toBeNull();
  });

  it("flags a 3rd-placed team only once 8 other groups' thirds are guaranteed above it", () => {
    // A3: out of top-2 (A1, A2 at 6 > ceiling 3), exactly 2 rivals above.
    const groupA = group("A", [6, 6, 0, 0], { gamesPlayed: 2, gamesTotal: 3 });
    const a3 = groupA.find((t) => t.teamId === "A3")!;

    // 7 strong other groups (third floor 4 > 3) is NOT enough.
    const seven = LETTERS.slice(1, 8).flatMap((l) => group(l, [7, 5, 4, 1]));
    const weakRest = LETTERS.slice(8, 12).flatMap((l) => group(l, [3, 3, 0, 0]));
    expect(isEliminatedFromTournament(a3, [...groupA, ...seven, ...weakRest])).toBe(false);

    // 8 strong other groups IS enough — A3 can't be a best-8 third.
    const eight = LETTERS.slice(1, 9).flatMap((l) => group(l, [7, 5, 4, 1]));
    const weakRest2 = LETTERS.slice(9, 12).flatMap((l) => group(l, [3, 3, 0, 0]));
    expect(isEliminatedFromTournament(a3, [...groupA, ...eight, ...weakRest2])).toBe(true);
  });

  it("flags a team that can't even finish its group's 3rd (>=3 rivals above)", () => {
    // A4: ceiling 3, beaten by A1(6), A2(6), A3(4) => 4th regardless => out,
    // no matter how weak the other groups are.
    const groupA = group("A", [6, 6, 4, 0], { gamesPlayed: 2, gamesTotal: 3 });
    const a4 = groupA.find((t) => t.teamId === "A4")!;
    const weak = LETTERS.slice(1, 12).flatMap((l) => group(l, [0, 0, 0, 0]));
    expect(isEliminatedFromTournament(a4, [...groupA, ...weak])).toBe(true);
  });

  it("does not flag anyone mid-stage when games remain and nothing is decided", () => {
    // After round 1 only: every team still has 6 reachable points, so no rival
    // can be guaranteed above anyone.
    const all = fillGroups(12, [3, 1, 1, 0]).map((t) => ({
      ...t,
      gamesPlayed: 1,
      gamesTotal: 3,
    }));
    expect(all.every((t) => !isEliminatedFromTournament(t, all))).toBe(true);
    expect(firstEliminatedTeamId(all)).toBeNull();
  });
});

describe("firstEliminatedTeamId — ordering", () => {
  it("returns the eliminated team whose clinching match finished earliest (nulls last)", () => {
    // Two clearly-eliminated last-place teams in fully-played groups; the rest weak.
    const groupA = group("A", [9, 6, 3, 0], { lastFinishedAt: 5000 }); // A4 out (3 rivals above)
    const groupB = group("B", [9, 6, 3, 0], { lastFinishedAt: 2000 }); // B4 out, earlier
    const rest = LETTERS.slice(2, 12).flatMap((l) => group(l, [0, 0, 0, 0]));
    expect(firstEliminatedTeamId([...groupA, ...groupB, ...rest])).toBe("B4");
  });
});

describe("format constant", () => {
  it("matches the WC 2026 best-thirds count", () => {
    expect(BEST_THIRDS_ADVANCING).toBe(8);
  });
});
