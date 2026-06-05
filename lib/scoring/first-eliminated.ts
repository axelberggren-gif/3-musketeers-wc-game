// Pure mirror of the SQL `score_first_eliminated()` elimination decision
// (supabase/migrations/0016_fix_first_eliminated_48team.sql). No IO.
//
// "First eliminated from the tournament" under WC 2026's 48-team format is NOT
// the same as "out of the group's top 2": 12 groups of 4, and the 8 best
// third-placed teams also advance. A team is eliminated only when it can finish
// neither in its group's top 2 NOR among the best-8 thirds.
//
// This module is the canonical spec the SQL function mirrors (same philosophy as
// the rules.ts <-> SQL points-sync invariant). If you change the logic in one
// place, change it in the other and keep first-eliminated.test.ts green.

/** Number of third-placed teams that advance under the WC 2026 48-team format. */
export const BEST_THIRDS_ADVANCING = 8;

export interface GroupStageTeam {
  teamId: string;
  /** Single uppercase group letter, e.g. "A".."L". */
  groupLetter: string;
  /** Current group-stage points (3 win / 1 draw / 0 loss). */
  pts: number;
  /** Finished group matches played so far. */
  gamesPlayed: number;
  /** Total group matches scheduled (normally 3). */
  gamesTotal: number;
  /**
   * Comparable timestamp of the team's most recent finished group match
   * (epoch ms), or null if it hasn't played. Used only to order simultaneously
   * detected eliminations — earliest first, nulls last.
   */
  lastFinishedAt: number | null;
}

/** Best points a team can still reach this group stage (loses nothing assumed won). */
export function maxReachablePoints(team: GroupStageTeam): number {
  return team.pts + 3 * (team.gamesTotal - team.gamesPlayed);
}

/**
 * Number of same-group rivals guaranteed to finish above `team`: a rival whose
 * CURRENT points already exceed `team`'s ceiling can never be caught (points
 * only increase). Strict `>` so ties never count as guaranteed-ahead.
 */
function rivalsGuaranteedAbove(team: GroupStageTeam, all: GroupStageTeam[]): number {
  const ceiling = maxReachablePoints(team);
  return all.filter(
    (o) => o.groupLetter === team.groupLetter && o.teamId !== team.teamId && o.pts > ceiling,
  ).length;
}

/**
 * The 3rd-largest current points among a group's teams (positional order
 * statistic). Because final points dominate current points component-wise, the
 * group's eventual 3rd-place team is guaranteed to finish with at least this
 * many points. Returns null for groups with fewer than 3 teams loaded.
 */
function groupThirdFloor(groupLetter: string, all: GroupStageTeam[]): number | null {
  const pts = all
    .filter((t) => t.groupLetter === groupLetter)
    .map((t) => t.pts)
    .sort((a, b) => b - a);
  return pts.length >= 3 ? pts[2] : null;
}

/**
 * True iff `team` is mathematically eliminated from the tournament — out of BOTH
 * its group's top 2 AND the best-8-thirds race — in every remaining scenario.
 * Sound (never false-positive); may settle later than the theoretical earliest
 * moment because it uses strict point bounds and no GD/GF tiebreaks.
 */
export function isEliminatedFromTournament(team: GroupStageTeam, all: GroupStageTeam[]): boolean {
  const rivalsAbove = rivalsGuaranteedAbove(team, all);

  // Can still reach the group's top 2.
  if (rivalsAbove < 2) return false;

  // >= 3 rivals guaranteed above => 4th-or-worse => can't even be its group's
  // 3rd => out of the thirds race entirely.
  if (rivalsAbove >= 3) return true;

  // Exactly 2 rivals above: out of top-2 but could still be its group's 3rd.
  // Eliminated only if >= 8 OTHER groups are each guaranteed to send a 3rd-place
  // team that outranks this team in the thirds pool.
  const ceiling = maxReachablePoints(team);
  const groups = [...new Set(all.map((t) => t.groupLetter))];
  const groupsThirdAbove = groups.filter((g) => {
    if (g === team.groupLetter) return false;
    const floor = groupThirdFloor(g, all);
    return floor !== null && floor > ceiling;
  }).length;

  return groupsThirdAbove >= BEST_THIRDS_ADVANCING;
}

/**
 * The team id that `score_first_eliminated()` would settle on given the current
 * standings, or null if no team is mathematically eliminated yet. Among multiple
 * eliminated teams, the one whose elimination-clinching match finished earliest
 * wins (nulls last) — matching the SQL ORDER BY.
 */
export function firstEliminatedTeamId(all: GroupStageTeam[]): string | null {
  const eliminated = all.filter((t) => isEliminatedFromTournament(t, all));
  if (eliminated.length === 0) return null;
  eliminated.sort((a, b) => {
    if (a.lastFinishedAt === null && b.lastFinishedAt === null) return 0;
    if (a.lastFinishedAt === null) return 1;
    if (b.lastFinishedAt === null) return -1;
    return a.lastFinishedAt - b.lastFinishedAt;
  });
  return eliminated[0].teamId;
}
