import { describe, expect, it } from "vitest";
import { FIFA_RANKINGS_2026 } from "./fifa-rankings";

// If these tests fail, either the canonical TS source drifted from the seed
// block at the bottom of supabase/migrations/0005_more_tournament_props.sql,
// or someone removed/duplicated a team. Both files must stay in sync.
describe("FIFA_RANKINGS_2026", () => {
  const entries = Object.entries(FIFA_RANKINGS_2026);

  it("contains exactly 48 teams", () => {
    expect(entries).toHaveLength(48);
  });

  it("ranks are a permutation of 1..48", () => {
    const ranks = entries.map(([, r]) => r).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
  });

  it("team codes are unique uppercase 3-letter TLAs", () => {
    const codes = entries.map(([c]) => c);
    expect(new Set(codes).size).toBe(48);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });
});
