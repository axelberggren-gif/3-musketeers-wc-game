import { supabaseServer } from "@/lib/supabase/server";
import type { Pick1X2 } from "@/lib/supabase/types";

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

// ─── IO loader ───────────────────────────────────────────────────────────────
/**
 * Loads the group-stage board for one or more users: every GROUP match plus each
 * user's 1X2 pick per match. RLS-aware — runs as the viewer, so another user's
 * picks only appear once `mp_read_after_lock` (migration 0026) grants them
 * (league-mates, after round-1 lock). Absent rows are indistinguishable from
 * hidden ones; callers gate their empty states on visible-pick counts.
 */
export async function loadGroupStagePicks(userIds: string[]): Promise<GroupStagePicks> {
  const supabase = await supabaseServer();
  const distinct = [...new Set(userIds)];

  const matchesRes = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, group_letter, status, home_score, away_score, winner, home:teams!home_team_id(name, code, crest_url), away:teams!away_team_id(name, code, crest_url)",
    )
    .eq("stage", "GROUP")
    .order("kickoff_at", { ascending: true });

  const picksRes =
    distinct.length > 0
      ? await supabase
          .from("match_predictions")
          .select("id, user_id, match_id, pick")
          .in("user_id", distinct)
      : { data: [] };

  const matches = (matchesRes.data ?? []) as unknown as GroupPickMatch[];
  const groupMatchIds = new Set(matches.map((m) => m.id));

  const picksByUser: Record<string, Record<string, VisiblePick>> = {};
  for (const id of distinct) picksByUser[id] = {};
  for (const row of picksRes.data ?? []) {
    if (!groupMatchIds.has(row.match_id)) continue;
    (picksByUser[row.user_id] ??= {})[row.match_id] = {
      pickId: row.id,
      pick: row.pick as Pick1X2,
    };
  }

  return { matches, picksByUser };
}
