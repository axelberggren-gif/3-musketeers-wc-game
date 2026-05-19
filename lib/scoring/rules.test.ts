import { describe, expect, it } from "vitest";
import { POINTS, bracketPointsForSlot } from "./rules";

// Mirror the constants in supabase/migrations/0002_scoring.sql. If these tests
// fail, either rules.ts drifted from the SQL (add a migration) or someone
// changed a value without bumping its twin.
describe("POINTS constants", () => {
  it("match 1X2 is 3 pts", () => {
    expect(POINTS.match1x2).toBe(3);
  });
  it("bracket stage values", () => {
    expect(POINTS.bracket.R16).toBe(2);
    expect(POINTS.bracket.QF).toBe(4);
    expect(POINTS.bracket.SF).toBe(6);
    expect(POINTS.bracket.F).toBe(10);
    expect(POINTS.bracket.WINNER).toBe(15);
  });
  it("tournament-prediction values", () => {
    expect(POINTS.tournament.winner).toBe(25);
    expect(POINTS.tournament.runnerUp).toBe(10);
    expect(POINTS.tournament.topScorer).toBe(15);
    expect(POINTS.tournament.darkHorse).toBe(10);
  });
  it("player prop is 10 pts", () => {
    expect(POINTS.playerProp).toBe(10);
  });
});

describe("bracketPointsForSlot", () => {
  it("handles indexed slots (STAGE-N)", () => {
    expect(bracketPointsForSlot("R16-1")).toBe(2);
    expect(bracketPointsForSlot("R16-8")).toBe(2);
    expect(bracketPointsForSlot("QF-A")).toBe(4);
    expect(bracketPointsForSlot("QF-D")).toBe(4);
    expect(bracketPointsForSlot("SF-A")).toBe(6);
    expect(bracketPointsForSlot("SF-B")).toBe(6);
  });
  it("handles bare-stage slots (F, W)", () => {
    expect(bracketPointsForSlot("F")).toBe(10);
    expect(bracketPointsForSlot("W")).toBe(15);
  });
  it("returns 0 for unknown slots", () => {
    expect(bracketPointsForSlot("3RD")).toBe(0);
    expect(bracketPointsForSlot("UNKNOWN")).toBe(0);
    expect(bracketPointsForSlot("")).toBe(0);
  });
});
