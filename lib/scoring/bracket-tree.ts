import type { Pick1X2 } from "@/lib/supabase/types";

export const BRACKET_UPSTREAM: Record<string, readonly string[]> = {
  "R16-1": ["R32-1", "R32-2"],
  "R16-2": ["R32-3", "R32-4"],
  "R16-3": ["R32-5", "R32-6"],
  "R16-4": ["R32-7", "R32-8"],
  "R16-5": ["R32-9", "R32-10"],
  "R16-6": ["R32-11", "R32-12"],
  "R16-7": ["R32-13", "R32-14"],
  "R16-8": ["R32-15", "R32-16"],
  "QF-A": ["R16-1", "R16-2"],
  "QF-B": ["R16-3", "R16-4"],
  "QF-C": ["R16-5", "R16-6"],
  "QF-D": ["R16-7", "R16-8"],
  "SF-A": ["QF-A", "QF-B"],
  "SF-B": ["QF-C", "QF-D"],
  F: ["SF-A", "SF-B"],
  W: ["F"],
} as const;

export function upstreamSlots(slot: string): readonly string[] {
  return BRACKET_UPSTREAM[slot] ?? [];
}

export const GROUP_LETTERS = [
  "A", "B", "C", "D", "E", "F",
  "G", "H", "I", "J", "K", "L",
] as const;

export type GroupMatch = {
  id: string;
  group_letter: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};

export type GroupStanding = {
  teamId: string;
  groupLetter: string;
  points: number;
  played: number;
};

export function predictedGroupStandings(
  matches: GroupMatch[],
  picksByMatchId: Record<string, Pick1X2>,
): GroupStanding[] {
  const acc = new Map<string, GroupStanding>();

  const seed = (teamId: string, groupLetter: string) => {
    const key = `${groupLetter}:${teamId}`;
    if (!acc.has(key)) {
      acc.set(key, { teamId, groupLetter, points: 0, played: 0 });
    }
    return acc.get(key)!;
  };

  for (const m of matches) {
    if (!m.group_letter || !m.home_team_id || !m.away_team_id) continue;
    const home = seed(m.home_team_id, m.group_letter);
    const away = seed(m.away_team_id, m.group_letter);
    const pick = picksByMatchId[m.id];
    if (!pick) continue;
    home.played += 1;
    away.played += 1;
    if (pick === "HOME") home.points += 3;
    else if (pick === "AWAY") away.points += 3;
    else {
      home.points += 1;
      away.points += 1;
    }
  }

  return [...acc.values()];
}

export type Qualifier = { slot: string; teamId: string };

export const R32_SLOT_COUNT = 16;

export function suggestR32Qualifiers(
  standings: GroupStanding[],
  teamNameById: Record<string, string>,
): Qualifier[] {
  const byGroup = new Map<string, GroupStanding[]>();
  for (const s of standings) {
    const arr = byGroup.get(s.groupLetter) ?? [];
    arr.push(s);
    byGroup.set(s.groupLetter, arr);
  }

  const sortStanding = (a: GroupStanding, b: GroupStanding) => {
    if (b.points !== a.points) return b.points - a.points;
    return (teamNameById[a.teamId] ?? a.teamId).localeCompare(
      teamNameById[b.teamId] ?? b.teamId,
    );
  };

  const advancers: GroupStanding[] = [];
  for (const letter of GROUP_LETTERS) {
    const sorted = (byGroup.get(letter) ?? []).slice().sort(sortStanding);
    if (sorted[0]) advancers.push(sorted[0]);
    if (sorted[1]) advancers.push(sorted[1]);
  }

  const top = advancers.sort(sortStanding).slice(0, R32_SLOT_COUNT);
  return top.map((s, idx) => ({ slot: `R32-${idx + 1}`, teamId: s.teamId }));
}
