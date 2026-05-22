// Single source of truth for point values. Update here, run migration 0002 to
// match in the database scoring functions.

export const POINTS = {
  match1x2: 3,
  bracket: {
    R16: 2,
    QF: 4,
    SF: 6,
    F: 10,
    WINNER: 15,
  },
  tournament: {
    winner: 25,
    runnerUp: 10,
    topScorer: 15,
    // Dark horse is rank-based: scores teams.fifa_ranking (1..48) if the
    // picked team reaches QF. See lib/scoring/fifa-rankings.ts.
    totalGoalsBase: 20,
    highestMatchBase: 15,
    troublemaker: 15,
    groupWinner: 5,
    firstEliminated: 10,
  },
  playerProp: 10,
} as const;

export type BracketStage = keyof typeof POINTS.bracket;

export const BRACKET_STAGE_BY_SLOT_PREFIX: Record<string, BracketStage> = {
  R16: "R16",
  QF: "QF",
  SF: "SF",
  F: "F",
  W: "WINNER",
};

export function bracketPointsForSlot(slot: string): number {
  const prefix = slot.split("-")[0] as keyof typeof BRACKET_STAGE_BY_SLOT_PREFIX;
  const stage = BRACKET_STAGE_BY_SLOT_PREFIX[prefix];
  return stage ? POINTS.bracket[stage] : 0;
}
