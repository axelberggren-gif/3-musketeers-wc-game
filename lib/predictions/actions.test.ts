import { beforeEach, describe, expect, it, vi } from "vitest";

// The four outright-numeric setters (setFinalGoalsGuess, setBiggestWinMarginGuess,
// setGoldenBootGoalsGuess, setTotalRedCardsGuess) range-validate their input and,
// for a valid value, delegate to setTournamentPick which authenticates and upserts
// into tournament_predictions. We mock the Supabase server client + revalidatePath
// + the lock state so the valid path reaches the upsert (asserted) and the invalid
// path is shown to early-return before any DB write (upsert NOT called).
const { upsert, getUser, single, supabaseServer } = vi.hoisted(() => {
  const upsert = vi.fn();
  const getUser = vi.fn();
  const single = vi.fn();
  // One chainable client serves both authedClient() (auth.getUser) and getLocks()
  // (from("tournament").select("*").single()) plus the write
  // (from("tournament_predictions").upsert(...)). from() returns the same builder.
  const builder = {
    select: vi.fn(() => builder),
    single,
    upsert,
  };
  const client = {
    auth: { getUser },
    from: vi.fn(() => builder),
  };
  return {
    upsert,
    getUser,
    single,
    supabaseServer: vi.fn(async () => client),
  };
});

vi.mock("@/lib/supabase/server", () => ({ supabaseServer }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/scoring/lock", () => ({
  // Round 1 unlocked so setTournamentPick proceeds to the upsert.
  computeLockState: vi.fn(() => ({ round1Locked: false, round2Locked: false })),
}));

import {
  setFinalGoalsGuess,
  setBiggestWinMarginGuess,
  setGoldenBootGoalsGuess,
  setTotalRedCardsGuess,
  setTotalGoalsGuess,
} from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  single.mockResolvedValue({ data: { first_kickoff_at: null, knockout_start_at: null } });
  upsert.mockResolvedValue({ error: null });
});

// Each prop has its own CHECK-mirrored max; the guard is
// `!Number.isInteger(value) || value < 0 || value > MAX`.
const cases = [
  { name: "setFinalGoalsGuess", fn: setFinalGoalsGuess, max: 30, column: "final_goals_guess" },
  { name: "setBiggestWinMarginGuess", fn: setBiggestWinMarginGuess, max: 30, column: "biggest_win_margin_guess" },
  { name: "setGoldenBootGoalsGuess", fn: setGoldenBootGoalsGuess, max: 30, column: "golden_boot_goals_guess" },
  { name: "setTotalRedCardsGuess", fn: setTotalRedCardsGuess, max: 200, column: "total_red_cards_guess" },
] as const;

describe.each(cases)("$name (range 0..$max)", ({ fn, max, column }) => {
  it("passes a valid value through to the upsert", async () => {
    const value = Math.min(max, 5);
    const result = await fn(value);

    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", [column]: value }),
      { onConflict: "user_id" },
    );
  });

  it("accepts the maximum boundary value", async () => {
    const result = await fn(max);

    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ [column]: max }),
      { onConflict: "user_id" },
    );
  });

  it("rejects a negative value without writing to the DB", async () => {
    const result = await fn(-1);

    expect(result).toEqual({
      ok: false,
      error: `Pick an integer between 0 and ${max}.`,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a value above the max without writing to the DB", async () => {
    const result = await fn(max + 1);

    expect(result).toEqual({
      ok: false,
      error: `Pick an integer between 0 and ${max}.`,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-integer value without writing to the DB", async () => {
    const result = await fn(1.5);

    expect(result).toEqual({
      ok: false,
      error: `Pick an integer between 0 and ${max}.`,
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

// setTotalGoalsGuess has NO upper bound (migration 0025) — only a non-negative
// integer floor. WC 2026's 104 matches can plausibly exceed the old 0..300 cap,
// and closest-guess scoring means an unbounded value can never inflate points.
describe("setTotalGoalsGuess (range 0..∞)", () => {
  it("passes a valid value through to the upsert", async () => {
    const result = await setTotalGoalsGuess(280);

    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", total_goals_guess: 280 }),
      { onConflict: "user_id" },
    );
  });

  it("accepts a value above the old 300 cap", async () => {
    const result = await setTotalGoalsGuess(9999);

    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ total_goals_guess: 9999 }),
      { onConflict: "user_id" },
    );
  });

  it("rejects a negative value without writing to the DB", async () => {
    const result = await setTotalGoalsGuess(-1);

    expect(result).toEqual({ ok: false, error: "Pick an integer of 0 or more." });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-integer value without writing to the DB", async () => {
    const result = await setTotalGoalsGuess(1.5);

    expect(result).toEqual({ ok: false, error: "Pick an integer of 0 or more." });
    expect(upsert).not.toHaveBeenCalled();
  });
});
