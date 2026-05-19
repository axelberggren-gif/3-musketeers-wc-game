import { describe, expect, it } from "vitest";
import { computeLockState, isLocked, matchIsLocked } from "./lock";
import type { Tournament } from "@/lib/supabase/types";

const TOURNAMENT: Tournament = {
  id: 1,
  first_kickoff_at: "2026-06-11T20:00:00Z",
  knockout_start_at: "2026-07-04T16:00:00Z",
  final_at: "2026-07-19T19:00:00Z",
  locked_overrides: null,
};

describe("computeLockState", () => {
  it("returns both rounds unlocked before first kickoff", () => {
    const s = computeLockState(TOURNAMENT, new Date("2026-06-01T00:00:00Z"));
    expect(s.round1Locked).toBe(false);
    expect(s.round2Locked).toBe(false);
  });
  it("locks round 1 at the moment of first kickoff", () => {
    const s = computeLockState(TOURNAMENT, new Date("2026-06-11T20:00:00Z"));
    expect(s.round1Locked).toBe(true);
    expect(s.round2Locked).toBe(false);
  });
  it("locks both rounds at knockout start", () => {
    const s = computeLockState(TOURNAMENT, new Date("2026-07-04T16:00:00Z"));
    expect(s.round1Locked).toBe(true);
    expect(s.round2Locked).toBe(true);
  });
  it("returns safe defaults when tournament row is missing", () => {
    const s = computeLockState(null);
    expect(s.round1Locked).toBe(false);
    expect(s.round2Locked).toBe(false);
    expect(s.firstKickoffAt.getTime()).toBe(0);
  });
});

describe("isLocked", () => {
  it("dispatches on kind", () => {
    const now = new Date("2026-06-11T20:00:00Z");
    expect(isLocked("round1", TOURNAMENT, now)).toBe(true);
    expect(isLocked("round2", TOURNAMENT, now)).toBe(false);
  });
});

describe("matchIsLocked", () => {
  it("flips at kickoff to the second", () => {
    const kickoff = "2026-06-15T18:00:00Z";
    expect(matchIsLocked(kickoff, new Date("2026-06-15T17:59:59Z"))).toBe(false);
    expect(matchIsLocked(kickoff, new Date("2026-06-15T18:00:00Z"))).toBe(true);
  });
  it("accepts a Date input", () => {
    const kickoff = new Date("2026-06-15T18:00:00Z");
    expect(matchIsLocked(kickoff, new Date("2026-06-15T18:00:01Z"))).toBe(true);
  });
});
