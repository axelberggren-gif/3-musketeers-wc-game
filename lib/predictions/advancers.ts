// Predicted advancers — derives "which 32 teams the user thinks will advance to
// the knockouts" from their group-stage 1X2 picks.
//
// WC 2026 format: 48 teams in 12 groups (A–L) of 4. After the group stage,
// 32 teams advance: top 2 from each group (24 teams) + 8 best 3rd-place teams.
//
// This module is pure logic — no IO, no React. It's used by the `/predict` page
// to render a read-only "Predicted advancers" section, and later by the scoring
// pipeline (PR 2b) to award points for correct advancer predictions.

export type Pick = "1" | "X" | "2";

export interface GroupMatchInput {
  id: string;
  home_team_id: string;
  away_team_id: string;
  group_letter: string;
}

export interface PickInput {
  match_id: string;
  pick: Pick;
}

export interface TeamInput {
  id: string;
  fifa_ranking: number | null;
}

export interface TeamStanding {
  team_id: string;
  group_letter: string;
  points: number;
  wins: number;
  draws: number;
  matches_played: number;
  /**
   * Which tiebreaker (if any) was needed to settle this team's position
   * relative to the team directly above it. `null` means the team was
   * separated by points alone.
   */
  tiebreaker: "head_to_head" | "fifa_ranking" | "unresolved" | null;
}

export interface AdvancersResult {
  winners: TeamStanding[]; // 12, sorted A..L
  runnersUp: TeamStanding[]; // 12, sorted A..L
  bestThirds: TeamStanding[]; // 8, sorted by points desc
  /**
   * Human-readable strings explaining where ties had to be broken — surfaced
   * in the UI so the user knows the advancer list involved a guess.
   */
  warnings: string[];
}

/**
 * For a single match's pick, return the points awarded to home and away.
 * No pick → both teams get 0 (this team will trail anyone with picks).
 */
function pickPoints(pick: Pick | null | undefined): { home: number; away: number } {
  switch (pick) {
    case "1":
      return { home: 3, away: 0 };
    case "X":
      return { home: 1, away: 1 };
    case "2":
      return { home: 0, away: 3 };
    default:
      return { home: 0, away: 0 };
  }
}

/**
 * Aggregate stats per team across all matches in one group, given the user's
 * 1X2 picks. Returns one entry per team that appears in any group match.
 */
export function aggregateGroupStats(
  groupMatches: GroupMatchInput[],
  picksByMatchId: Map<string, Pick>,
): Map<string, Omit<TeamStanding, "tiebreaker">> {
  const stats = new Map<string, Omit<TeamStanding, "tiebreaker">>();

  const ensure = (team_id: string, group_letter: string) => {
    let s = stats.get(team_id);
    if (!s) {
      s = { team_id, group_letter, points: 0, wins: 0, draws: 0, matches_played: 0 };
      stats.set(team_id, s);
    }
    return s;
  };

  for (const m of groupMatches) {
    const pick = picksByMatchId.get(m.id);
    if (!pick) continue; // No pick → team gets nothing for this match
    const { home, away } = pickPoints(pick);
    const homeStats = ensure(m.home_team_id, m.group_letter);
    const awayStats = ensure(m.away_team_id, m.group_letter);
    homeStats.points += home;
    awayStats.points += away;
    homeStats.matches_played += 1;
    awayStats.matches_played += 1;
    if (pick === "1") homeStats.wins += 1;
    else if (pick === "2") awayStats.wins += 1;
    else {
      homeStats.draws += 1;
      awayStats.draws += 1;
    }
  }

  return stats;
}

/**
 * Resolve the head-to-head pick between two teams in a group. Returns:
 *   - "home" if the pick says A beats B (A was home and picked "1", etc.)
 *   - "away" if the pick says B beats A
 *   - null if drawn or no pick
 */
function headToHeadResult(
  aId: string,
  bId: string,
  groupMatches: GroupMatchInput[],
  picksByMatchId: Map<string, Pick>,
): "a" | "b" | null {
  const match = groupMatches.find(
    (m) =>
      (m.home_team_id === aId && m.away_team_id === bId) ||
      (m.home_team_id === bId && m.away_team_id === aId),
  );
  if (!match) return null;
  const pick = picksByMatchId.get(match.id);
  if (!pick || pick === "X") return null;
  const homeWins = pick === "1";
  if (match.home_team_id === aId) return homeWins ? "a" : "b";
  return homeWins ? "b" : "a";
}

/**
 * Sort one group's teams. Returns the sorted array plus a list of tiebreaker
 * warnings ("Group A: 2nd/3rd separated by FIFA rank" etc.). Mutates each
 * standing's `tiebreaker` field to record what separated it from the team
 * above.
 */
export function sortGroup(
  group_letter: string,
  rawStats: Omit<TeamStanding, "tiebreaker">[],
  groupMatches: GroupMatchInput[],
  picksByMatchId: Map<string, Pick>,
  fifaRankByTeamId: Map<string, number | null>,
): { sorted: TeamStanding[]; warnings: string[] } {
  const warnings: string[] = [];

  // Start with points-desc sort.
  const sorted: TeamStanding[] = rawStats
    .slice()
    .sort((a, b) => b.points - a.points)
    .map((s) => ({ ...s, tiebreaker: null }));

  // Walk pairs and apply tiebreakers when points equal.
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].points !== sorted[i - 1].points) continue;

    // Try head-to-head pick between the two teams.
    const h2h = headToHeadResult(
      sorted[i - 1].team_id,
      sorted[i].team_id,
      groupMatches,
      picksByMatchId,
    );
    if (h2h === "a") {
      // Order already correct (a > b means sorted[i-1] beats sorted[i]).
      sorted[i].tiebreaker = "head_to_head";
      continue;
    }
    if (h2h === "b") {
      // Swap.
      [sorted[i - 1], sorted[i]] = [sorted[i], sorted[i - 1]];
      sorted[i].tiebreaker = "head_to_head";
      // After swap, re-check pair at i-1 (could now tie with i-2).
      if (i >= 2 && sorted[i - 1].points === sorted[i - 2].points) i--;
      continue;
    }

    // Head-to-head was a draw or missing → FIFA ranking.
    const rankA = fifaRankByTeamId.get(sorted[i - 1].team_id);
    const rankB = fifaRankByTeamId.get(sorted[i].team_id);
    if (rankA != null && rankB != null && rankA !== rankB) {
      if (rankA > rankB) {
        // B is better-ranked (lower rank number), swap.
        [sorted[i - 1], sorted[i]] = [sorted[i], sorted[i - 1]];
      }
      sorted[i].tiebreaker = "fifa_ranking";
      warnings.push(
        `Group ${group_letter}: positions ${i} & ${i + 1} tied on points — separated by FIFA rank.`,
      );
      if (i >= 2 && sorted[i - 1].points === sorted[i - 2].points) i--;
      continue;
    }

    // Truly unresolvable — record but leave in current order.
    sorted[i].tiebreaker = "unresolved";
    warnings.push(
      `Group ${group_letter}: positions ${i} & ${i + 1} tied on points — no tiebreaker available.`,
    );
  }

  return { sorted, warnings };
}

/**
 * Top-level entry point. Takes all group-stage matches + the user's picks +
 * teams (for FIFA rank tiebreaker) and returns the 32 advancers grouped by
 * category.
 */
export function deriveAdvancers(
  groupMatches: GroupMatchInput[],
  picks: PickInput[],
  teams: TeamInput[],
): AdvancersResult {
  const picksByMatchId = new Map(picks.map((p) => [p.match_id, p.pick]));
  const fifaRankByTeamId = new Map(teams.map((t) => [t.id, t.fifa_ranking]));

  // Bucket matches by group letter (A–L).
  const matchesByGroup = new Map<string, GroupMatchInput[]>();
  for (const m of groupMatches) {
    const arr = matchesByGroup.get(m.group_letter) ?? [];
    arr.push(m);
    matchesByGroup.set(m.group_letter, arr);
  }

  const allWarnings: string[] = [];
  const winners: TeamStanding[] = [];
  const runnersUp: TeamStanding[] = [];
  const thirds: TeamStanding[] = [];

  // Process groups in alphabetical order so the UI is deterministic.
  const groupLetters = Array.from(matchesByGroup.keys()).sort();
  for (const letter of groupLetters) {
    const groupMatchesForLetter = matchesByGroup.get(letter)!;
    const rawStats = Array.from(
      aggregateGroupStats(groupMatchesForLetter, picksByMatchId).values(),
    );
    if (rawStats.length === 0) continue;

    const { sorted, warnings } = sortGroup(
      letter,
      rawStats,
      groupMatchesForLetter,
      picksByMatchId,
      fifaRankByTeamId,
    );
    allWarnings.push(...warnings);

    if (sorted[0]) winners.push(sorted[0]);
    if (sorted[1]) runnersUp.push(sorted[1]);
    if (sorted[2]) thirds.push(sorted[2]);
  }

  // Pick 8 best 3rd-places. Sort by points desc, then by FIFA rank as
  // tiebreaker (lower rank = better).
  const sortedThirds = thirds.slice().sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const rankA = fifaRankByTeamId.get(a.team_id) ?? Number.POSITIVE_INFINITY;
    const rankB = fifaRankByTeamId.get(b.team_id) ?? Number.POSITIVE_INFINITY;
    return rankA - rankB;
  });
  const bestThirds = sortedThirds.slice(0, 8).map((t, i): TeamStanding => {
    // Flag any 3rd that's only included because of a FIFA-rank tiebreaker
    // against the 9th-place team (the one we cut off).
    const cutoff = sortedThirds[8];
    if (cutoff && cutoff.points === t.points) {
      return { ...t, tiebreaker: "fifa_ranking" };
    }
    return { ...t, tiebreaker: i === 0 ? null : t.tiebreaker };
  });

  if (sortedThirds.length > 8 && sortedThirds[7]?.points === sortedThirds[8]?.points) {
    allWarnings.push("Best 3rd-place: cut-off tied on points — separated by FIFA rank.");
  }

  return { winners, runnersUp, bestThirds, warnings: allWarnings };
}
