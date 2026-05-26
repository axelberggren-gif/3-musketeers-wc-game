// Pulse stats — League/Tournament panel feeding `components/stats/PulseTabs.tsx`.
// Mirrors the shape of `loadProfileStats` (lib/stats/profile.ts): two top-level
// loaders, both async, returning a flat object the renderer can treat as dumb data.
//
// Scope decisions (issue #37 open questions, resolved for v1):
// - "Matchday" = UTC calendar date of `matches.kickoff_at`.
// - "Upset" = finished match where the rank-favourite (lower `fifa_ranking`) lost
//   AND the rank delta ≥ 5; DRAW does not count as an upset.
// - "Cinderella" reads `tournament_predictions.dark_horse_team_id`.
// - Cohort for BOTH league and tournament highlights is the current league's
//   members. The match-fact tournament tiles (avg goals, upsets, total goals,
//   red cards) read the actual tournament, no cohort needed. This keeps every
//   query inside RLS — no `supabaseService()` needed.

import { supabaseServer } from "@/lib/supabase/server";

export interface PulseTile {
  key: string;
  label: string;
  value: string;
  sublabel?: string;
}

export interface PulseHighlight {
  key: string;
  label: string;
  primary: string;
  secondary: string;
}

export interface LeaguePulse {
  tiles: PulseTile[];
  highlights: PulseHighlight[];
}

export interface TournamentPulse {
  tiles: PulseTile[];
  highlights: PulseHighlight[];
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests in pulse.test.ts.
// ---------------------------------------------------------------------------

export function computeCurrentStreak(events: { correct: boolean }[]): number {
  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].correct) streak++;
    else break;
  }
  return streak;
}

export function isBoldPick(myPick: string, distribution: Record<string, number>): boolean {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total < 2) return false;
  const myShare = (distribution[myPick] ?? 0) / total;
  return myShare < 0.25;
}

export function perfectMatchdays(
  picks: { date: string; correct: boolean }[],
): number {
  const byDate = new Map<string, { picks: number; correct: number }>();
  for (const p of picks) {
    const e = byDate.get(p.date) ?? { picks: 0, correct: 0 };
    e.picks += 1;
    if (p.correct) e.correct += 1;
    byDate.set(p.date, e);
  }
  let n = 0;
  for (const e of byDate.values()) {
    if (e.picks > 0 && e.picks === e.correct) n++;
  }
  return n;
}

// Gini-impurity-style contestability score. Higher = more evenly split.
export function contestabilityScore(distribution: Record<string, number>): number {
  const counts = [distribution.HOME ?? 0, distribution.DRAW ?? 0, distribution.AWAY ?? 0];
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return 1 - counts.reduce((acc, c) => acc + (c / total) ** 2, 0);
}

export const UPSET_RANK_DELTA = 5;

// ---------------------------------------------------------------------------
// League pulse
// ---------------------------------------------------------------------------

const ZERO_TILES_LEAGUE: PulseTile[] = [
  { key: "gap", label: "Leader's gap", value: "—" },
  { key: "streak", label: "Hottest streak", value: "—" },
  { key: "bold", label: "Bold picks", value: "—" },
  { key: "perfect", label: "Perfect MDs", value: "—" },
];

const ZERO_HIGHLIGHTS_LEAGUE: PulseHighlight[] = [
  { key: "contested", label: "Most contested", primary: "—", secondary: "No finished matches yet" },
  { key: "consensus", label: "Group consensus", primary: "—", secondary: "No group picks yet" },
  { key: "wildcard", label: "Wildcard pick", primary: "—", secondary: "No correct underdog picks yet" },
];

export async function loadLeaguePulse(
  leagueId: string,
  userId: string,
): Promise<LeaguePulse> {
  const supabase = await supabaseServer();

  const membersRes = await supabase
    .from("league_members")
    .select("user_id, profiles!user_id(username, display_name)")
    .eq("league_id", leagueId);
  const members = membersRes.data ?? [];
  const memberIds = members.map((m) => m.user_id);
  if (memberIds.length === 0) {
    return { tiles: ZERO_TILES_LEAGUE, highlights: ZERO_HIGHLIGHTS_LEAGUE };
  }
  const profileById = new Map<string, { username: string; display_name: string | null }>();
  for (const m of members) {
    if (m.profiles) {
      profileById.set(m.user_id, {
        username: m.profiles.username,
        display_name: m.profiles.display_name,
      });
    }
  }

  const [standingsRes, picksRes, awardsRes, groupPicksRes] = await Promise.all([
    supabase
      .from("league_standings")
      .select("user_id, total_points")
      .eq("league_id", leagueId)
      .order("total_points", { ascending: false }),
    // RLS (mp_read_after_kickoff) filters to finished matches the viewer can see.
    // We still scope the in-clause to league members so an extra league the
    // viewer is in doesn't pollute the dataset.
    supabase
      .from("match_predictions")
      .select("user_id, match_id, pick, match:matches!match_id(id, kickoff_at, status, home_team_id, away_team_id, home:teams!home_team_id(code, name), away:teams!away_team_id(code, name))")
      .in("user_id", memberIds),
    supabase
      .from("point_awards")
      .select("user_id, match_id, points, prediction_type")
      .in("user_id", memberIds)
      .eq("prediction_type", "match"),
    supabase
      .from("group_winner_predictions")
      .select("user_id, group_letter, team_id, team:teams!team_id(code, name)")
      .in("user_id", memberIds),
  ]);

  const standings = standingsRes.data ?? [];
  const rawPicks = picksRes.data ?? [];
  const awards = awardsRes.data ?? [];
  const groupPicks = groupPicksRes.data ?? [];

  // Keep only picks on finished matches (RLS already gates, but the embedded
  // match join still surfaces non-finished rows for the viewer's own picks).
  const finishedPicks = rawPicks.filter((p) => p.match && p.match.status === "FINISHED");

  // Build a Set of "(user_id, match_id)" keys with a non-zero match award —
  // those are the user's correct picks. RLS scopes both sides identically.
  const correctSet = new Set<string>();
  for (const a of awards) {
    if (a.match_id && (a.points ?? 0) > 0) {
      correctSet.add(`${a.user_id}|${a.match_id}`);
    }
  }
  const isCorrect = (uid: string, mid: string) => correctSet.has(`${uid}|${mid}`);

  // --- Tile 1: leader's gap ------------------------------------------------
  const sortedStandings = [...standings].sort(
    (a, b) => (b.total_points ?? 0) - (a.total_points ?? 0),
  );
  let gapValue = "—";
  let gapSub: string | undefined;
  if (sortedStandings.length >= 2) {
    const gap = (sortedStandings[0].total_points ?? 0) - (sortedStandings[1].total_points ?? 0);
    gapValue = String(gap);
    const leaderProfile = sortedStandings[0].user_id
      ? profileById.get(sortedStandings[0].user_id)
      : null;
    gapSub = leaderProfile
      ? `${leaderProfile.display_name ?? leaderProfile.username} leads`
      : "leader leads";
  } else if (sortedStandings.length === 1) {
    gapValue = String(sortedStandings[0].total_points ?? 0);
    gapSub = "Solo so far";
  }

  // --- Tile 2: hottest current streak -------------------------------------
  const picksByUser = new Map<string, { match_id: string; kickoff_at: string; correct: boolean }[]>();
  for (const p of finishedPicks) {
    if (!p.match) continue;
    const arr = picksByUser.get(p.user_id) ?? [];
    arr.push({
      match_id: p.match_id,
      kickoff_at: p.match.kickoff_at,
      correct: isCorrect(p.user_id, p.match_id),
    });
    picksByUser.set(p.user_id, arr);
  }
  let hottestStreak = 0;
  let hottestUserId: string | null = null;
  for (const [uid, events] of picksByUser.entries()) {
    events.sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
    const s = computeCurrentStreak(events);
    if (s > hottestStreak) {
      hottestStreak = s;
      hottestUserId = uid;
    }
  }
  const hottestProfile = hottestUserId ? profileById.get(hottestUserId) : null;
  const streakTile: PulseTile = {
    key: "streak",
    label: "Hottest streak",
    value: hottestStreak > 0 ? `${hottestStreak}` : "—",
    sublabel: hottestProfile
      ? `${hottestProfile.display_name ?? hottestProfile.username} on fire`
      : hottestStreak > 0
        ? undefined
        : "No streaks yet",
  };

  // --- Tile 3: bold picks (viewer-scoped) ---------------------------------
  // Pick distribution per match across league members.
  const distByMatch = new Map<string, Record<string, number>>();
  for (const p of finishedPicks) {
    const d = distByMatch.get(p.match_id) ?? { HOME: 0, DRAW: 0, AWAY: 0 };
    d[p.pick] = (d[p.pick] ?? 0) + 1;
    distByMatch.set(p.match_id, d);
  }
  let viewerBoldCount = 0;
  for (const p of finishedPicks) {
    if (p.user_id !== userId) continue;
    const dist = distByMatch.get(p.match_id);
    if (dist && isBoldPick(p.pick, dist)) viewerBoldCount += 1;
  }

  // --- Tile 4: perfect MDs (viewer-scoped) --------------------------------
  const viewerEvents = (picksByUser.get(userId) ?? []).map((e) => ({
    date: e.kickoff_at.slice(0, 10),
    correct: e.correct,
  }));
  const viewerPerfectMDs = perfectMatchdays(viewerEvents);

  const tiles: PulseTile[] = [
    { key: "gap", label: "Leader's gap", value: gapValue, sublabel: gapSub },
    streakTile,
    {
      key: "bold",
      label: "Bold picks",
      value: viewerBoldCount > 0 ? String(viewerBoldCount) : "—",
      sublabel: viewerBoldCount > 0 ? "You vs the room" : "Nothing bold yet",
    },
    {
      key: "perfect",
      label: "Perfect MDs",
      value: viewerPerfectMDs > 0 ? String(viewerPerfectMDs) : "—",
      sublabel: viewerPerfectMDs > 0 ? "Days you swept" : "No clean sweeps yet",
    },
  ];

  // --- Highlight 1: most contested match ----------------------------------
  let mostContested: PulseHighlight = ZERO_HIGHLIGHTS_LEAGUE[0];
  {
    let best: { matchId: string; score: number; dist: Record<string, number> } | null = null;
    for (const [matchId, dist] of distByMatch.entries()) {
      const score = contestabilityScore(dist);
      const total = (dist.HOME ?? 0) + (dist.DRAW ?? 0) + (dist.AWAY ?? 0);
      if (total < 3) continue;
      if (!best || score > best.score) best = { matchId, score, dist };
    }
    if (best) {
      const sample = finishedPicks.find((p) => p.match_id === best!.matchId);
      const home = sample?.match?.home?.code ?? "?";
      const away = sample?.match?.away?.code ?? "?";
      mostContested = {
        key: "contested",
        label: "Most contested",
        primary: `${home} vs ${away}`,
        secondary: `${best.dist.HOME ?? 0}H · ${best.dist.DRAW ?? 0}D · ${best.dist.AWAY ?? 0}A`,
      };
    }
  }

  // --- Highlight 2: group consensus ---------------------------------------
  let groupConsensus: PulseHighlight = ZERO_HIGHLIGHTS_LEAGUE[1];
  {
    const byGroup = new Map<string, Map<string, { count: number; code: string; name: string }>>();
    for (const g of groupPicks) {
      const inner = byGroup.get(g.group_letter) ?? new Map();
      const entry = inner.get(g.team_id) ?? {
        count: 0,
        code: g.team?.code ?? "?",
        name: g.team?.name ?? "?",
      };
      entry.count += 1;
      inner.set(g.team_id, entry);
      byGroup.set(g.group_letter, inner);
    }
    let bestGroup: { letter: string; share: number; code: string; name: string } | null = null;
    for (const [letter, inner] of byGroup.entries()) {
      const total = Array.from(inner.values()).reduce((a, b) => a + b.count, 0);
      if (total < 2) continue;
      let topTeam = { count: 0, code: "?", name: "?" };
      for (const e of inner.values()) if (e.count > topTeam.count) topTeam = e;
      const share = topTeam.count / total;
      if (!bestGroup || share > bestGroup.share) {
        bestGroup = { letter, share, code: topTeam.code, name: topTeam.name };
      }
    }
    if (bestGroup) {
      groupConsensus = {
        key: "consensus",
        label: "Group consensus",
        primary: `Group ${bestGroup.letter} → ${bestGroup.code}`,
        secondary: `${Math.round(bestGroup.share * 100)}% agree on ${bestGroup.name}`,
      };
    }
  }

  // --- Highlight 3: wildcard pick -----------------------------------------
  let wildcard: PulseHighlight = ZERO_HIGHLIGHTS_LEAGUE[2];
  {
    let lowestShare: { share: number; userId: string; matchId: string } | null = null;
    for (const p of finishedPicks) {
      if (!isCorrect(p.user_id, p.match_id)) continue;
      const dist = distByMatch.get(p.match_id);
      if (!dist) continue;
      const total = (dist.HOME ?? 0) + (dist.DRAW ?? 0) + (dist.AWAY ?? 0);
      if (total < 3) continue;
      const share = (dist[p.pick] ?? 0) / total;
      if (!lowestShare || share < lowestShare.share) {
        lowestShare = { share, userId: p.user_id, matchId: p.match_id };
      }
    }
    if (lowestShare) {
      const winner = profileById.get(lowestShare.userId);
      const sample = finishedPicks.find(
        (p) => p.user_id === lowestShare!.userId && p.match_id === lowestShare!.matchId,
      );
      const home = sample?.match?.home?.code ?? "?";
      const away = sample?.match?.away?.code ?? "?";
      const pick = sample?.pick ?? "?";
      wildcard = {
        key: "wildcard",
        label: "Wildcard pick",
        primary: `${winner?.display_name ?? winner?.username ?? "?"} → ${pick}`,
        secondary: `${home} vs ${away} · ${Math.round(lowestShare.share * 100)}% agreed`,
      };
    }
  }

  return { tiles, highlights: [mostContested, groupConsensus, wildcard] };
}

// ---------------------------------------------------------------------------
// Tournament pulse
// ---------------------------------------------------------------------------

const ZERO_TILES_TOURNAMENT: PulseTile[] = [
  { key: "avgGoals", label: "Avg goals / match", value: "—" },
  { key: "upsets", label: "Upsets so far", value: "—" },
  { key: "totalGoals", label: "Total goals", value: "—" },
  { key: "redCards", label: "Red cards", value: "—" },
];

const ZERO_HIGHLIGHTS_TOURNAMENT: PulseHighlight[] = [
  { key: "champion", label: "Most-picked champion", primary: "—", secondary: "No locked picks yet" },
  { key: "goldenBoot", label: "Golden boot pick", primary: "—", secondary: "No locked picks yet" },
  { key: "cinderella", label: "Cinderella vote", primary: "—", secondary: "No dark-horse picks yet" },
];

export async function loadTournamentPulse(leagueId: string): Promise<TournamentPulse> {
  const supabase = await supabaseServer();

  const membersRes = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId);
  const memberIds = (membersRes.data ?? []).map((m) => m.user_id);

  const [matchesRes, redCardsRes, tournamentPicksRes] = await Promise.all([
    supabase
      .from("matches")
      .select("home_score, away_score, status, winner, home:teams!home_team_id(fifa_ranking), away:teams!away_team_id(fifa_ranking)")
      .eq("status", "FINISHED"),
    supabase
      .from("player_card_log")
      .select("id", { count: "exact", head: true })
      .eq("card_type", "RED"),
    memberIds.length > 0
      ? supabase
          .from("tournament_predictions")
          .select("user_id, winner_team_id, top_scorer_player_id, dark_horse_team_id, winner:teams!winner_team_id(code, name), top_scorer:players!top_scorer_player_id(name), dark_horse:teams!dark_horse_team_id(code, name)")
          .in("user_id", memberIds)
      : Promise.resolve({ data: [], error: null, count: null, status: 200, statusText: "OK" } as const),
  ]);

  const matches = matchesRes.data ?? [];
  const redCardCount = redCardsRes.count ?? 0;
  const tournamentPicks = (tournamentPicksRes as { data: unknown[] | null }).data ?? [];

  // --- Tournament tiles ---------------------------------------------------
  let totalGoals = 0;
  let goalMatchCount = 0;
  let upsetCount = 0;
  for (const m of matches) {
    const h = m.home_score ?? 0;
    const a = m.away_score ?? 0;
    if (m.home_score != null && m.away_score != null) {
      totalGoals += h + a;
      goalMatchCount += 1;
    }
    const homeRank = m.home?.fifa_ranking ?? null;
    const awayRank = m.away?.fifa_ranking ?? null;
    if (homeRank != null && awayRank != null && m.winner && m.winner !== "DRAW") {
      const favHome = homeRank < awayRank;
      const delta = Math.abs(homeRank - awayRank);
      const upset =
        delta >= UPSET_RANK_DELTA &&
        ((favHome && m.winner === "AWAY") || (!favHome && m.winner === "HOME"));
      if (upset) upsetCount += 1;
    }
  }
  const avgGoals = goalMatchCount > 0 ? totalGoals / goalMatchCount : 0;

  const tiles: PulseTile[] =
    goalMatchCount === 0 && redCardCount === 0
      ? ZERO_TILES_TOURNAMENT
      : [
          {
            key: "avgGoals",
            label: "Avg goals / match",
            value: goalMatchCount > 0 ? avgGoals.toFixed(1) : "—",
            sublabel: goalMatchCount > 0 ? `${goalMatchCount} finished` : undefined,
          },
          {
            key: "upsets",
            label: "Upsets so far",
            value: String(upsetCount),
            sublabel: `≥${UPSET_RANK_DELTA} rank delta`,
          },
          {
            key: "totalGoals",
            label: "Total goals",
            value: String(totalGoals),
          },
          {
            key: "redCards",
            label: "Red cards",
            value: String(redCardCount),
          },
        ];

  // --- Tournament highlights (league-scoped cohort) -----------------------
  type TournamentRow = {
    user_id: string;
    winner_team_id: string | null;
    top_scorer_player_id: string | null;
    dark_horse_team_id: string | null;
    winner: { code: string; name: string } | null;
    top_scorer: { name: string } | null;
    dark_horse: { code: string; name: string } | null;
  };
  const picks = tournamentPicks as TournamentRow[];
  const total = picks.length;

  function topCount<T extends { count: number }>(
    pickKey: (p: TournamentRow) => string | null,
    seed: (p: TournamentRow) => T,
  ): T | null {
    const counts = new Map<string, T>();
    for (const p of picks) {
      const k = pickKey(p);
      if (!k) continue;
      const existing = counts.get(k);
      if (existing) existing.count += 1;
      else counts.set(k, { ...seed(p), count: 1 });
    }
    let best: T | null = null;
    for (const e of counts.values()) if (!best || e.count > best.count) best = e;
    return best;
  }

  let championHL: PulseHighlight = ZERO_HIGHLIGHTS_TOURNAMENT[0];
  const topWinner = topCount(
    (p) => p.winner_team_id,
    (p) => ({ code: p.winner?.code ?? "?", name: p.winner?.name ?? "?", count: 0 }),
  );
  if (topWinner && total > 0) {
    championHL = {
      key: "champion",
      label: "Most-picked champion",
      primary: `${topWinner.code} — ${topWinner.name}`,
      secondary: `${topWinner.count}/${total} picked it`,
    };
  }

  let goldenBootHL: PulseHighlight = ZERO_HIGHLIGHTS_TOURNAMENT[1];
  const topScorer = topCount(
    (p) => p.top_scorer_player_id,
    (p) => ({ name: p.top_scorer?.name ?? "?", count: 0 }),
  );
  if (topScorer && total > 0) {
    goldenBootHL = {
      key: "goldenBoot",
      label: "Golden boot pick",
      primary: topScorer.name,
      secondary: `${topScorer.count}/${total} picked it`,
    };
  }

  let cinderellaHL: PulseHighlight = ZERO_HIGHLIGHTS_TOURNAMENT[2];
  const topDarkHorse = topCount(
    (p) => p.dark_horse_team_id,
    (p) => ({ code: p.dark_horse?.code ?? "?", name: p.dark_horse?.name ?? "?", count: 0 }),
  );
  if (topDarkHorse && total > 0) {
    cinderellaHL = {
      key: "cinderella",
      label: "Cinderella vote",
      primary: `${topDarkHorse.code} — ${topDarkHorse.name}`,
      secondary: `${topDarkHorse.count}/${total} dark-horsed`,
    };
  }

  return { tiles, highlights: [championHL, goldenBootHL, cinderellaHL] };
}
