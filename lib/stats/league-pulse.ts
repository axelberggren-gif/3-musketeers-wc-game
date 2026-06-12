import { pickOutcome, type GroupPickMatch, type VisiblePick } from "./picks-shared";

// Pure "league pulse" math for the /today start page: per-match pick
// distributions, pairwise look-alike/opposite agreement, and recent form
// streaks. IO-free and client-safe (the loader side stays in group-picks.ts);
// every helper takes the `picksByUser` shape returned by loadGroupStagePicks,
// so RLS has already scoped what the viewer may count.

// ─── Per-match pick distribution ─────────────────────────────────────────────
export interface MatchPickTally {
  home: number;
  draw: number;
  away: number;
  /** Visible picks on this match (home + draw + away). */
  total: number;
}

/** How the given users split on one match: N home / N draw / N away. */
export function tallyMatchPicks(
  matchId: string,
  picksByUser: Record<string, Record<string, VisiblePick>>,
): MatchPickTally {
  const tally: MatchPickTally = { home: 0, draw: 0, away: 0, total: 0 };
  for (const picks of Object.values(picksByUser)) {
    const p = picks[matchId];
    if (!p) continue;
    if (p.pick === "HOME") tally.home++;
    else if (p.pick === "DRAW") tally.draw++;
    else tally.away++;
    tally.total++;
  }
  return tally;
}

// ─── Look-alikes & opposites ─────────────────────────────────────────────────
export interface AgreementRow {
  userId: string;
  /** Matches where both users have a visible pick. */
  both: number;
  /** …of those, how many are the same call. */
  same: number;
}

/**
 * Agreement between the viewer and every other user in `picksByUser`, sorted
 * most-alike first (same desc, then both desc, then userId for stability).
 * First row = your look-alike, last row = your opposite.
 */
export function rankAgreement(
  selfId: string,
  picksByUser: Record<string, Record<string, VisiblePick>>,
): AgreementRow[] {
  const selfPicks = picksByUser[selfId] ?? {};
  const rows: AgreementRow[] = [];
  for (const [userId, picks] of Object.entries(picksByUser)) {
    if (userId === selfId) continue;
    let both = 0;
    let same = 0;
    for (const [matchId, p] of Object.entries(picks)) {
      const mine = selfPicks[matchId];
      if (!mine) continue;
      both++;
      if (mine.pick === p.pick) same++;
    }
    rows.push({ userId, both, same });
  }
  return rows.sort(
    (a, b) => b.same - a.same || b.both - a.both || a.userId.localeCompare(b.userId),
  );
}

// ─── Recent form & streaks ───────────────────────────────────────────────────
export type FormDot = "correct" | "wrong";

export interface FormSummary {
  /** Outcomes of the last `window` decided picks, oldest → newest. */
  dots: FormDot[];
  /** The run the user is currently on (counted over ALL decided picks). */
  streak: { kind: FormDot; length: number } | null;
  decided: number;
}

/**
 * One user's recent form over the decided matches (FINISHED with a winner),
 * in kickoff order. `matches` must already be kickoff-ascending — true for
 * loadGroupStagePicks output.
 */
export function recentForm(
  matches: GroupPickMatch[],
  picks: Record<string, { pick: VisiblePick["pick"] }>,
  window = 5,
): FormSummary {
  const sequence: FormDot[] = [];
  for (const m of matches) {
    const p = picks[m.id];
    if (!p) continue;
    const outcome = pickOutcome(p.pick, m);
    if (outcome === "pending") continue;
    sequence.push(outcome);
  }
  let streak: FormSummary["streak"] = null;
  if (sequence.length > 0) {
    const kind = sequence[sequence.length - 1];
    let length = 0;
    for (let i = sequence.length - 1; i >= 0 && sequence[i] === kind; i--) length++;
    streak = { kind, length };
  }
  return { dots: sequence.slice(-window), streak, decided: sequence.length };
}
