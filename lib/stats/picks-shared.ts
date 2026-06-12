import type { Pick1X2 } from "@/lib/supabase/types";

// Pure types + helpers for revealed group-stage picks, split out of
// `group-picks.ts` so client components can import them — the loader module
// pulls in `supabaseServer()` (→ next/headers), which poisons client bundles.
// IO-free by design, like `lib/league-bets/shared.ts`.

// ─── Public types ─────────────────────────────────────────────────────────────
export type Winner = "HOME" | "DRAW" | "AWAY";
export type PickOutcome = "correct" | "wrong" | "pending";

export interface GroupPickTeam {
  name: string;
  code: string;
  crest_url: string | null;
}

export interface GroupPickMatch {
  id: string;
  kickoff_at: string;
  group_letter: string | null;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  winner: Winner | null;
  home: GroupPickTeam | null;
  away: GroupPickTeam | null;
}

export interface VisiblePick {
  /** match_predictions.id — drives the pick-reaction strip. */
  pickId: string;
  pick: Pick1X2;
}

export interface GroupStagePicks {
  /** Every group-stage match in kickoff order (the board's row source). */
  matches: GroupPickMatch[];
  /** userId → matchId → that user's pick, scoped by RLS to what the viewer may see. */
  picksByUser: Record<string, Record<string, VisiblePick>>;
}

// ─── Pure helpers (exported for unit tests) ─────────────────────────────────────

/** Was this pick right? `pending` until the match is FINISHED with a winner. */
export function pickOutcome(
  pick: Pick1X2,
  match: { status: string | null; winner: Winner | null },
): PickOutcome {
  if (match.status !== "FINISHED" || match.winner == null) return "pending";
  return pick === match.winner ? "correct" : "wrong";
}

export interface PickRecord {
  /** Visible picks on matches whose result is in. */
  decided: number;
  correct: number;
  /** All visible picks, decided or not. */
  made: number;
}

/** Correct/decided/made counts for one user's picks over the match list. */
export function tallyPickRecord(
  matches: { id: string; status: string | null; winner: Winner | null }[],
  picks: Record<string, { pick: Pick1X2 }>,
): PickRecord {
  let decided = 0;
  let correct = 0;
  let made = 0;
  for (const m of matches) {
    const p = picks[m.id];
    if (!p) continue;
    made++;
    const outcome = pickOutcome(p.pick, m);
    if (outcome === "pending") continue;
    decided++;
    if (outcome === "correct") correct++;
  }
  return { decided, correct, made };
}

/** Matches bucketed by group letter (A..L sorted; letterless ones dropped). */
export function groupMatchesByLetter(
  matches: GroupPickMatch[],
): { letter: string; matches: GroupPickMatch[] }[] {
  const byLetter = new Map<string, GroupPickMatch[]>();
  for (const m of matches) {
    if (!m.group_letter) continue;
    const bucket = byLetter.get(m.group_letter) ?? [];
    bucket.push(m);
    byLetter.set(m.group_letter, bucket);
  }
  return [...byLetter.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([letter, ms]) => ({ letter, matches: ms }));
}
