// Single source of truth for point values. Update here, run migration 0002 to
// match in the database scoring functions.

export const POINTS = {
  match1x2: 3,
  bracket: {
    // R32 is the first knockout round in WC 2026 (32 teams: 12 group winners +
    // 12 runners-up + 8 best 3rd-place). Less prestigious than R16, so 1 pt.
    R32: 1,
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
    firstEliminated: 10,
    // Outright "closest guess wins, ties split the base" numeric props (0020).
    // finalGoals + biggestWinMargin settle off scorelines; goldenBootGoals +
    // totalRedCards are drain-gated (read the goal / card logs).
    finalGoalsBase: 10,
    biggestWinMarginBase: 10,
    goldenBootGoalsBase: 10,
    totalRedCardsBase: 15,
  },
  playerProp: 10,
  // Admin-resolved "house special" props (migration 0022): Neymar minutes,
  // streaker, best goalkeeper, golden-boot team, own-goals count, war-game
  // match, Swedish-players count. Flat 5 pts each (numeric ones split ties).
  // Mirrored by points_manual_prop() in 0022_manual_admin_props.sql.
  manualProp: 5,
} as const;

export type BracketStage = keyof typeof POINTS.bracket;

export const BRACKET_STAGE_BY_SLOT_PREFIX: Record<string, BracketStage> = {
  R32: "R32",
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
