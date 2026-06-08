// Shared constants for the internal league bets (crown 👑 + poop 💩). Imported by
// both the server action and the client UI, so keep this IO-free and directive-free.

export const BET_KINDS = ["most_points", "least_points"] as const;
export type BetKind = (typeof BET_KINDS)[number];

export const BET_EMOJI: Record<BetKind, string> = {
  most_points: "👑",
  least_points: "💩",
};

export const BET_LABEL: Record<BetKind, string> = {
  most_points: "Most points",
  least_points: "Least points",
};

export function isBetKind(value: string): value is BetKind {
  return (BET_KINDS as readonly string[]).includes(value);
}

// Per-member running totals of votes received, used by the tally badges.
export type VoteTally = { crown: number; poop: number };
