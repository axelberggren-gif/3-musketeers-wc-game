import { describe, expect, it } from "vitest";
import {
  computeCurrentStreak,
  contestabilityScore,
  isBoldPick,
  perfectMatchdays,
} from "./pulse";

describe("computeCurrentStreak", () => {
  it("returns 0 on empty input", () => {
    expect(computeCurrentStreak([])).toBe(0);
  });
  it("counts trailing correct picks only", () => {
    expect(
      computeCurrentStreak([
        { correct: true },
        { correct: false },
        { correct: true },
        { correct: true },
      ]),
    ).toBe(2);
  });
  it("resets to 0 when most recent pick is wrong", () => {
    expect(
      computeCurrentStreak([{ correct: true }, { correct: true }, { correct: false }]),
    ).toBe(0);
  });
});

describe("isBoldPick", () => {
  it("is false with fewer than 2 total picks", () => {
    expect(isBoldPick("HOME", { HOME: 1 })).toBe(false);
  });
  it("is true when share < 25%", () => {
    expect(isBoldPick("DRAW", { HOME: 5, DRAW: 1, AWAY: 5 })).toBe(true);
  });
  it("is false when share >= 25%", () => {
    expect(isBoldPick("HOME", { HOME: 3, DRAW: 3, AWAY: 4 })).toBe(false);
  });
});

describe("perfectMatchdays", () => {
  it("returns 0 on empty input", () => {
    expect(perfectMatchdays([])).toBe(0);
  });
  it("counts days where every pick was correct", () => {
    expect(
      perfectMatchdays([
        { date: "2026-06-11", correct: true },
        { date: "2026-06-11", correct: true },
        { date: "2026-06-12", correct: true },
        { date: "2026-06-12", correct: false },
      ]),
    ).toBe(1);
  });
  it("does not count days with no correct picks", () => {
    expect(
      perfectMatchdays([
        { date: "2026-06-11", correct: false },
        { date: "2026-06-11", correct: false },
      ]),
    ).toBe(0);
  });
});

describe("contestabilityScore", () => {
  it("is 0 with no picks", () => {
    expect(contestabilityScore({})).toBe(0);
  });
  it("is 0 when all picks agree", () => {
    expect(contestabilityScore({ HOME: 10, DRAW: 0, AWAY: 0 })).toBe(0);
  });
  it("is maximal when picks are evenly split", () => {
    const even = contestabilityScore({ HOME: 3, DRAW: 3, AWAY: 3 });
    const lopsided = contestabilityScore({ HOME: 7, DRAW: 1, AWAY: 1 });
    expect(even).toBeGreaterThan(lopsided);
  });
});
