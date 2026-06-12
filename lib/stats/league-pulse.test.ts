import { describe, expect, it } from "vitest";
import { rankAgreement, recentForm, tallyMatchPicks } from "./league-pulse";
import type { GroupPickMatch, VisiblePick } from "./picks-shared";
import type { Pick1X2 } from "@/lib/supabase/types";

// ── helpers to build fixtures ────────────────────────────────────────────────
type W = "HOME" | "DRAW" | "AWAY";
const match = (
  id: string,
  status: string | null,
  winner: W | null,
  kickoff = "2026-06-11T20:00:00Z",
): GroupPickMatch => ({
  id,
  kickoff_at: kickoff,
  group_letter: "A",
  status,
  home_score: null,
  away_score: null,
  winner,
  home: { name: "Home", code: "HOM", crest_url: null },
  away: { name: "Away", code: "AWY", crest_url: null },
});

const pick = (p: Pick1X2): VisiblePick => ({ pickId: `pk-${p}`, pick: p });

describe("tallyMatchPicks", () => {
  const picksByUser = {
    u1: { m1: pick("HOME"), m2: pick("DRAW") },
    u2: { m1: pick("HOME") },
    u3: { m1: pick("AWAY") },
    u4: {},
  };

  it("splits visible picks on a match into home/draw/away", () => {
    expect(tallyMatchPicks("m1", picksByUser)).toEqual({
      home: 2,
      draw: 0,
      away: 1,
      total: 3,
    });
    expect(tallyMatchPicks("m2", picksByUser)).toEqual({
      home: 0,
      draw: 1,
      away: 0,
      total: 1,
    });
  });

  it("returns an all-zero tally when nobody picked the match", () => {
    expect(tallyMatchPicks("m9", picksByUser)).toEqual({
      home: 0,
      draw: 0,
      away: 0,
      total: 0,
    });
  });
});

describe("rankAgreement", () => {
  it("counts overlapping picks and same calls per other user", () => {
    const rows = rankAgreement("me", {
      me: { m1: pick("HOME"), m2: pick("DRAW"), m3: pick("AWAY") },
      twin: { m1: pick("HOME"), m2: pick("DRAW"), m3: pick("HOME") },
      rival: { m1: pick("AWAY"), m2: pick("HOME") },
    });
    expect(rows).toEqual([
      { userId: "twin", both: 3, same: 2 },
      { userId: "rival", both: 2, same: 0 },
    ]);
  });

  it("ignores matches only one side picked and excludes self", () => {
    const rows = rankAgreement("me", {
      me: { m1: pick("HOME") },
      other: { m2: pick("HOME") },
    });
    expect(rows).toEqual([{ userId: "other", both: 0, same: 0 }]);
  });

  it("breaks same-count ties by overlap then userId for a stable order", () => {
    const rows = rankAgreement("me", {
      me: { m1: pick("HOME"), m2: pick("DRAW") },
      b: { m1: pick("HOME") },
      a: { m1: pick("HOME") },
      c: { m1: pick("HOME"), m2: pick("DRAW") },
    });
    expect(rows.map((r) => r.userId)).toEqual(["c", "a", "b"]);
  });
});

describe("recentForm", () => {
  const matches = [
    match("m1", "FINISHED", "HOME", "2026-06-11T16:00:00Z"),
    match("m2", "FINISHED", "AWAY", "2026-06-11T19:00:00Z"),
    match("m3", "FINISHED", "HOME", "2026-06-12T16:00:00Z"),
    match("m4", "LIVE", null, "2026-06-12T19:00:00Z"),
    match("m5", "FINISHED", null, "2026-06-12T22:00:00Z"), // winner lag → pending
  ];

  it("collects decided outcomes in kickoff order and the trailing streak", () => {
    const form = recentForm(matches, {
      m1: { pick: "HOME" }, // correct
      m2: { pick: "HOME" }, // wrong
      m3: { pick: "HOME" }, // correct
      m4: { pick: "HOME" }, // pending — skipped
      m5: { pick: "HOME" }, // pending — skipped
    });
    expect(form.dots).toEqual(["correct", "wrong", "correct"]);
    expect(form.streak).toEqual({ kind: "correct", length: 1 });
    expect(form.decided).toBe(3);
  });

  it("counts the current streak across the full history, dots only the window", () => {
    const many = [
      match("m1", "FINISHED", "HOME", "2026-06-10T16:00:00Z"),
      match("m2", "FINISHED", "HOME", "2026-06-10T19:00:00Z"),
      match("m3", "FINISHED", "HOME", "2026-06-11T16:00:00Z"),
      match("m4", "FINISHED", "HOME", "2026-06-11T19:00:00Z"),
      match("m5", "FINISHED", "HOME", "2026-06-12T16:00:00Z"),
      match("m6", "FINISHED", "HOME", "2026-06-12T19:00:00Z"),
    ];
    const allHome = Object.fromEntries(many.map((m) => [m.id, { pick: "HOME" as const }]));
    const form = recentForm(many, allHome, 5);
    expect(form.dots).toHaveLength(5);
    expect(form.streak).toEqual({ kind: "correct", length: 6 });
  });

  it("returns the empty shape when nothing is decided", () => {
    expect(recentForm(matches, {})).toEqual({ dots: [], streak: null, decided: 0 });
  });
});
