import type { Tournament } from "@/lib/supabase/types";

export type LockKind = "round1" | "round2";

export interface LockState {
  round1Locked: boolean;
  round2Locked: boolean;
  firstKickoffAt: Date;
  knockoutStartAt: Date;
}

export interface ComputeLockOptions {
  /**
   * When true, the viewer is exempt from the round-2 (knockout bracket) lock —
   * their league was granted post-knockout bracket access via
   * `tournament.locked_overrides.round2_open_leagues` (migration 0032). Mirrors
   * the SQL `round2_locked_for()` exemption so the UI + server actions agree with
   * the DB trigger. Resolved by `isRound2Exempt()` in
   * `lib/predictions/round2-access.ts`. Does not affect round 1.
   */
  round2Exempt?: boolean;
}

export function computeLockState(
  tournament: Tournament | null,
  now = new Date(),
  opts: ComputeLockOptions = {},
): LockState {
  if (!tournament) {
    return {
      round1Locked: false,
      round2Locked: false,
      firstKickoffAt: new Date(0),
      knockoutStartAt: new Date(0),
    };
  }
  const firstKickoffAt = new Date(tournament.first_kickoff_at);
  const knockoutStartAt = new Date(tournament.knockout_start_at);
  return {
    round1Locked: now >= firstKickoffAt,
    round2Locked: now >= knockoutStartAt && !opts.round2Exempt,
    firstKickoffAt,
    knockoutStartAt,
  };
}

export function isLocked(kind: LockKind, tournament: Tournament | null, now = new Date()) {
  const state = computeLockState(tournament, now);
  return kind === "round1" ? state.round1Locked : state.round2Locked;
}

export function matchIsLocked(kickoffAt: string | Date, now = new Date()) {
  const kickoff = typeof kickoffAt === "string" ? new Date(kickoffAt) : kickoffAt;
  return now >= kickoff;
}
