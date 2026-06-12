import { describe, expect, it } from "vitest";
import {
  groupMatchesByLetter,
  pickOutcome,
  tallyPickRecord,
  type GroupPickMatch,
} from "./group-picks";

// ── helpers to build fixtures ────────────────────────────────────────────────
type W = "HOME" | "DRAW" | "AWAY";
const match = (
  id: string,
  status: string | null,
  winner: W | null,
  group_letter: string | null = "A",
  kickoff = "2026-06-11T20:00:00Z",
): GroupPickMatch => ({
  id,
  kickoff_at: kickoff,
  group_letter,
  status,
  home_score: null,
  away_score: null,
  winner,
  home: { name: "Home", code: "HOM", crest_url: null },
  away: { name: "Away", code: "AWY", crest_url: null },
});

describe("pickOutcome", () => {
  it("is correct when the pick matches a finished match's winner", () => {
    expect(pickOutcome("HOME", { status: "FINISHED", winner: "HOME" })).toBe("correct");
    expect(pickOutcome("DRAW", { status: "FINISHED", winner: "DRAW" })).toBe("correct");
  });

  it("is wrong when the pick misses a finished match's winner", () => {
    expect(pickOutcome("AWAY", { status: "FINISHED", winner: "HOME" })).toBe("wrong");
  });

  it("is pending before the match finishes", () => {
    expect(pickOutcome("HOME", { status: "SCHEDULED", winner: null })).toBe("pending");
    expect(pickOutcome("HOME", { status: "LIVE", winner: null })).toBe("pending");
  });

  it("is pending on a FINISHED match whose winner hasn't resolved yet", () => {
    // football-data can report FINISHED with a null winner for a window after FT.
    expect(pickOutcome("HOME", { status: "FINISHED", winner: null })).toBe("pending");
  });
});

describe("tallyPickRecord", () => {
  const matches = [
    match("m1", "FINISHED", "HOME"),
    match("m2", "FINISHED", "AWAY"),
    match("m3", "SCHEDULED", null),
    match("m4", "FINISHED", null), // unresolved winner → not decided
  ];

  it("counts made / decided / correct over the visible picks", () => {
    const record = tallyPickRecord(matches, {
      m1: { pick: "HOME" }, // correct
      m2: { pick: "HOME" }, // wrong
      m3: { pick: "DRAW" }, // pending
      m4: { pick: "HOME" }, // pending (no winner yet)
    });
    expect(record).toEqual({ made: 4, decided: 2, correct: 1 });
  });

  it("ignores matches without a pick and handles the empty case", () => {
    expect(tallyPickRecord(matches, { m1: { pick: "HOME" } })).toEqual({
      made: 1,
      decided: 1,
      correct: 1,
    });
    expect(tallyPickRecord(matches, {})).toEqual({ made: 0, decided: 0, correct: 0 });
  });
});

describe("groupMatchesByLetter", () => {
  it("buckets by letter in alphabetical order and keeps kickoff order within", () => {
    const grouped = groupMatchesByLetter([
      match("m1", null, null, "B"),
      match("m2", null, null, "A"),
      match("m3", null, null, "B"),
    ]);
    expect(grouped.map((g) => g.letter)).toEqual(["A", "B"]);
    expect(grouped[1].matches.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("drops matches with no group letter", () => {
    expect(groupMatchesByLetter([match("m1", null, null, null)])).toEqual([]);
  });
});
