import { describe, expect, it } from "vitest";
import {
  deriveBracketSlot,
  mapStage,
  mapStatus,
  mapWinner,
  resolveWinner,
  type FdMatch,
} from "./client";

function fakeMatch(over: {
  status: FdMatch["status"];
  stage?: FdMatch["stage"];
  winner?: FdMatch["score"]["winner"];
  home?: number | null;
  away?: number | null;
}): FdMatch {
  return {
    id: 1,
    utcDate: "2026-06-11T20:00:00Z",
    status: over.status,
    stage: over.stage ?? "GROUP_STAGE",
    group: "GROUP_A",
    homeTeam: { id: 1, name: "Mexico", shortName: "Mexico", tla: "MEX", crest: null },
    awayTeam: { id: 2, name: "South Africa", shortName: "S. Africa", tla: "RSA", crest: null },
    score: {
      winner: over.winner ?? null,
      fullTime: { home: over.home ?? null, away: over.away ?? null },
    },
  };
}

describe("deriveBracketSlot", () => {
  it("labels R32 slots 1..16 by index", () => {
    expect(deriveBracketSlot("R32", 0)).toBe("R32-1");
    expect(deriveBracketSlot("R32", 15)).toBe("R32-16");
  });
  it("labels R16 slots 1..8 by index", () => {
    expect(deriveBracketSlot("R16", 0)).toBe("R16-1");
    expect(deriveBracketSlot("R16", 7)).toBe("R16-8");
  });
  it("labels QF slots A..D and SF slots A..B", () => {
    expect(deriveBracketSlot("QF", 0)).toBe("QF-A");
    expect(deriveBracketSlot("QF", 3)).toBe("QF-D");
    expect(deriveBracketSlot("SF", 0)).toBe("SF-A");
    expect(deriveBracketSlot("SF", 1)).toBe("SF-B");
  });
  it("uses bare 'F' and '3RD' for those stages", () => {
    expect(deriveBracketSlot("F", 0)).toBe("F");
    expect(deriveBracketSlot("3RD", 0)).toBe("3RD");
  });
  it("returns null for group-stage matches", () => {
    expect(deriveBracketSlot("GROUP", 0)).toBeNull();
  });
});

describe("mapStage", () => {
  it("translates football-data stage enum", () => {
    expect(mapStage("GROUP_STAGE")).toBe("GROUP");
    expect(mapStage("LAST_32")).toBe("R32");
    expect(mapStage("LAST_16")).toBe("R16");
    expect(mapStage("QUARTER_FINALS")).toBe("QF");
    expect(mapStage("SEMI_FINALS")).toBe("SF");
    expect(mapStage("THIRD_PLACE")).toBe("3RD");
    expect(mapStage("FINAL")).toBe("F");
  });
});

describe("mapWinner", () => {
  it("collapses HOME_TEAM / AWAY_TEAM / DRAW", () => {
    expect(mapWinner("HOME_TEAM")).toBe("HOME");
    expect(mapWinner("AWAY_TEAM")).toBe("AWAY");
    expect(mapWinner("DRAW")).toBe("DRAW");
    expect(mapWinner(null)).toBeNull();
  });
});

describe("resolveWinner", () => {
  it("uses score.winner when football-data provides it", () => {
    expect(resolveWinner(fakeMatch({ status: "FINISHED", winner: "HOME_TEAM", home: 2, away: 0 }))).toBe("HOME");
    expect(resolveWinner(fakeMatch({ status: "FINISHED", winner: "AWAY_TEAM", home: 0, away: 1 }))).toBe("AWAY");
    expect(resolveWinner(fakeMatch({ status: "FINISHED", winner: "DRAW", home: 1, away: 1 }))).toBe("DRAW");
  });

  it("falls back to the scoreline when a FINISHED match has a null winner", () => {
    // football-data's bulk /matches endpoint commonly reports FINISHED with a
    // populated fullTime score but winner still null for a while after FT.
    expect(resolveWinner(fakeMatch({ status: "FINISHED", winner: null, home: 2, away: 1 }))).toBe("HOME");
    expect(resolveWinner(fakeMatch({ status: "FINISHED", winner: null, home: 0, away: 3 }))).toBe("AWAY");
    expect(resolveWinner(fakeMatch({ status: "FINISHED", winner: null, home: 1, away: 1 }))).toBe("DRAW");
  });

  it("never invents a winner before a match is FINISHED", () => {
    expect(resolveWinner(fakeMatch({ status: "IN_PLAY", winner: null, home: 1, away: 0 }))).toBeNull();
    expect(resolveWinner(fakeMatch({ status: "SCHEDULED", winner: null, home: null, away: null }))).toBeNull();
  });

  it("stays null on a FINISHED match missing a scoreline", () => {
    expect(resolveWinner(fakeMatch({ status: "FINISHED", winner: null, home: null, away: null }))).toBeNull();
  });

  it("does not label a level knockout a draw (ET/penalties decide it via score.winner)", () => {
    expect(
      resolveWinner(fakeMatch({ status: "FINISHED", stage: "LAST_16", winner: null, home: 1, away: 1 })),
    ).toBeNull();
    // A decisive knockout scoreline still resolves.
    expect(
      resolveWinner(fakeMatch({ status: "FINISHED", stage: "FINAL", winner: null, home: 2, away: 1 })),
    ).toBe("HOME");
  });
});

describe("mapStatus", () => {
  it("collapses in-play states to LIVE and cancelled-likes to POSTPONED", () => {
    expect(mapStatus("IN_PLAY")).toBe("LIVE");
    expect(mapStatus("PAUSED")).toBe("LIVE");
    expect(mapStatus("FINISHED")).toBe("FINISHED");
    expect(mapStatus("POSTPONED")).toBe("POSTPONED");
    expect(mapStatus("SUSPENDED")).toBe("POSTPONED");
    expect(mapStatus("CANCELLED")).toBe("POSTPONED");
    expect(mapStatus("SCHEDULED")).toBe("SCHEDULED");
    expect(mapStatus("TIMED")).toBe("SCHEDULED");
  });
});
