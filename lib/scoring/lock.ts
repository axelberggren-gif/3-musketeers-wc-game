import type { Tournament } from "@/lib/supabase/types";

export type LockKind = "round1" | "round2";

export interface LockState {
  round1Locked: boolean;
  round2Locked: boolean;
  firstKickoffAt: Date;
  knockoutStartAt: Date;
}

export function computeLockState(tournament: Tournament | null, now = new Date()): LockState {
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
    round2Locked: now >= knockoutStartAt,
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
