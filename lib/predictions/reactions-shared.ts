export const PICK_REACTION_EMOJI = ["🔥", "💩", "😱", "👍"] as const;
export type PickReactionEmoji = (typeof PICK_REACTION_EMOJI)[number];
export type PickKind = "match" | "bracket" | "tournament" | "prop";

export interface PickReactionAggregate {
  counts: Record<PickReactionEmoji, number>;
  mine: Set<PickReactionEmoji>;
}

export function aggregateKey(kind: PickKind, pickId: string): string {
  return `${kind}:${pickId}`;
}
