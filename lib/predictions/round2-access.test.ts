import { beforeEach, describe, expect, it, vi } from "vitest";

// isRound2Exempt() awaits supabaseServer() only when there *are* open leagues,
// then runs from("league_members").select(...).eq(...).in(...). Mock that chain
// so the IO branch is exercised without a real client; the no-open-leagues path
// short-circuits before any of it. round2OpenLeagueIds() is pure (no IO).
const { inMock, eqMock, fromMock, supabaseServer } = vi.hoisted(() => {
  const inMock = vi.fn();
  const eqMock = vi.fn(() => ({ in: inMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return {
    inMock,
    eqMock,
    fromMock,
    supabaseServer: vi.fn(async () => ({ from: fromMock })),
  };
});

vi.mock("@/lib/supabase/server", () => ({ supabaseServer }));

import { round2OpenLeagueIds, isRound2Exempt } from "./round2-access";
import type { Tournament } from "@/lib/supabase/types";

// round2OpenLeagueIds only reads `locked_overrides`; the rest of the row is
// irrelevant to it, so a minimal cast keeps the fixtures focused.
function tournamentWith(locked_overrides: unknown): Tournament {
  return { id: 1, locked_overrides } as unknown as Tournament;
}

describe("round2OpenLeagueIds", () => {
  it("returns [] for a null tournament", () => {
    expect(round2OpenLeagueIds(null)).toEqual([]);
  });
  it("returns [] when locked_overrides is null", () => {
    expect(round2OpenLeagueIds(tournamentWith(null))).toEqual([]);
  });
  it("returns [] when locked_overrides is the empty object", () => {
    expect(round2OpenLeagueIds(tournamentWith({}))).toEqual([]);
  });
  it("returns [] when the round2_open_leagues key is absent", () => {
    expect(round2OpenLeagueIds(tournamentWith({ something_else: 1 }))).toEqual([]);
  });
  it("returns [] when round2_open_leagues is not an array", () => {
    expect(round2OpenLeagueIds(tournamentWith({ round2_open_leagues: "nope" }))).toEqual([]);
  });
  it("returns [] when locked_overrides is itself an array", () => {
    expect(round2OpenLeagueIds(tournamentWith(["a", "b"]))).toEqual([]);
  });
  it("returns the league ids when round2_open_leagues holds valid strings", () => {
    const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
    expect(round2OpenLeagueIds(tournamentWith({ round2_open_leagues: ids }))).toEqual(ids);
  });
  it("keeps only the string elements of a mixed-type array", () => {
    expect(
      round2OpenLeagueIds(
        tournamentWith({ round2_open_leagues: ["a", 5, null, "b", true, { x: 1 }] }),
      ),
    ).toEqual(["a", "b"]);
  });
});

describe("isRound2Exempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false without touching the DB when no leagues are open", async () => {
    const result = await isRound2Exempt(tournamentWith({}), "user-1");
    expect(result).toBe(false);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("returns true when the user is a member of an open league", async () => {
    inMock.mockResolvedValue({ data: [{ league_id: "league-a" }] });
    const result = await isRound2Exempt(
      tournamentWith({ round2_open_leagues: ["league-a"] }),
      "user-1",
    );
    expect(result).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("league_members");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(inMock).toHaveBeenCalledWith("league_id", ["league-a"]);
  });

  it("returns false when the user is in no open league", async () => {
    inMock.mockResolvedValue({ data: [] });
    const result = await isRound2Exempt(
      tournamentWith({ round2_open_leagues: ["league-a"] }),
      "user-1",
    );
    expect(result).toBe(false);
  });

  it("treats a null data result as not exempt", async () => {
    inMock.mockResolvedValue({ data: null });
    const result = await isRound2Exempt(
      tournamentWith({ round2_open_leagues: ["league-a"] }),
      "user-1",
    );
    expect(result).toBe(false);
  });
});
