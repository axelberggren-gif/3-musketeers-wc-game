import { describe, expect, it } from "vitest";
import { deriveBracketSlot, mapStage, mapStatus, mapWinner } from "./client";

describe("deriveBracketSlot", () => {
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
