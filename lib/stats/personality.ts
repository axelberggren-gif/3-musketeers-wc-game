import { supabaseServer } from "@/lib/supabase/server";
import type { Pick1X2 } from "@/lib/supabase/types";

// ─── Tunable constants ──────────────────────────────────────────────────────
/** A pick is "bold" when fewer than this share of the league cohort shares it. */
export const BOLDNESS_MAX_SHARE = 0.25;
/** Min FIFA-rank gap (winner worse than the team it beat) to count an "upset". */
export const UPSET_RANK_MARGIN = 5;
/** Knockout rounds, shallowest → deepest. Bracket survival is rounds-won / rungs. */
export const KNOCKOUT_LADDER: readonly string[] = ["R32", "R16", "QF", "SF", "F"];

// ─── Public types ─────────────────────────────────────────────────────────────
/** A "you vs league" comparison metric. `cohortAvg` is null when there's no cohort. */
export interface ComparisonStat {
  /** The profile owner's own value as a 0..1 fraction, or null with no sample. */
  userValue: number | null;
  /** The owner's denominator (e.g. finished group picks). Lets the UI show "4/7". */
  userSample: number;
  /** How many correct, for the "4/7" hint (= round(userValue*userSample) otherwise). */
  userCorrect: number;
  /** League cohort average as a 0..1 fraction (mean of per-member fractions), or null. */
  cohortAvg: number | null;
  /** Number of cohort members (incl. the owner) that contributed a value. */
  cohortN: number;
}

export interface PickPersonality {
  /** True only when the viewer is the profile owner — drives copy ("Your" vs "Their"). */
  isSelf: boolean;

  /** Pick-mix across the owner's visible match picks (group stage in practice). */
  pickMix: {
    home: number;
    draw: number;
    away: number;
    total: number;
    /** Integer percentages summing to 100 (largest-remainder); null when total === 0. */
    pct: { home: number; draw: number; away: number } | null;
  };

  groupAccuracy: ComparisonStat;
  knockoutAccuracy: ComparisonStat;
  bracketSurvival: ComparisonStat;

  /** % of the owner's kicked-off picks that were low-consensus; null when no data. */
  boldnessPct: number | null;
  boldnessSample: number;
  /** Mean lead time before kickoff, in hours / days (UI picks the nicer unit). */
  avgPickLeadHours: number | null;
  avgPickLeadDays: number | null;
  /** Correct group picks where the weaker side (by FIFA rank) won; null if no ranks. */
  upsetsCalled: number | null;

  leagueCount: number;
  /** True when the visible cohort is effectively just the owner (≤1 member). */
  soloCohort: boolean;
}

// ─── Internal row shapes (boundary-cast from Supabase, see lib/supabase/CLAUDE.md) ──
type Winner = "HOME" | "DRAW" | "AWAY";

interface MatchInfo {
  id: string;
  stage: string;
  kickoff_at: string;
  status: string | null;
  winner: Winner | null;
  home_team_id: string | null;
  away_team_id: string | null;
}
interface OwnMatchPick {
  pick: Pick1X2;
  submitted_at: string;
  match: MatchInfo | null;
}
interface BracketPick {
  bracket_slot: string;
  team_id: string;
}
interface KnockoutMatch {
  bracket_slot: string | null;
  stage: string;
  status: string | null;
  winner: Winner | null;
  home_team_id: string | null;
  away_team_id: string | null;
}
interface CohortMatchPick {
  user_id: string;
  pick: Pick1X2;
  match_id: string;
  match: { stage: string; status: string | null; winner: Winner | null } | null;
}
interface CohortBracketPick {
  user_id: string;
  bracket_slot: string;
  team_id: string;
}

export interface PersonalityInput {
  ownMatchPicks: OwnMatchPick[];
  ownBracketPicks: BracketPick[];
  knockoutMatches: KnockoutMatch[];
  ranksByTeam: Map<string, number | null>;
  cohortMatchPicks: CohortMatchPick[];
  cohortBracketPicks: CohortBracketPick[];
  cohortIds: string[];
  userId: string;
  leagueCount: number;
  isSelf: boolean;
}

// ─── Pure helpers (exported for unit tests) ─────────────────────────────────────

/** Integer percentages summing to exactly 100 via largest-remainder; null if total 0. */
export function largestRemainderPct(
  home: number,
  draw: number,
  away: number,
): { home: number; draw: number; away: number } | null {
  const total = home + draw + away;
  if (total <= 0) return null;
  const raw = [home, draw, away].map((n) => (n / total) * 100);
  const result = raw.map(Math.floor);
  let leftover = 100 - result.reduce((a, b) => a + b, 0);
  const byFrac = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < byFrac.length && leftover > 0; k++) {
    result[byFrac[k].i] += 1;
    leftover--;
  }
  return { home: result[0], draw: result[1], away: result[2] };
}

export function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function isFinishedGroup(m: { stage: string; status: string | null; winner: Winner | null } | null) {
  return !!m && m.stage === "GROUP" && m.status === "FINISHED" && m.winner != null;
}

/** Owner's group-stage 1X2 accuracy over finished matches. */
export function groupAccuracyOf(rows: OwnMatchPick[]): { sample: number; correct: number } {
  let sample = 0;
  let correct = 0;
  for (const r of rows) {
    if (!isFinishedGroup(r.match)) continue;
    sample++;
    if (r.pick === r.match!.winner) correct++;
  }
  return { sample, correct };
}

/** Mean of each cohort member's own group accuracy (equal-weight "average player"). */
export function cohortGroupAccuracy(rows: CohortMatchPick[]): { avg: number | null; n: number } {
  const byUser = new Map<string, { sample: number; correct: number }>();
  for (const r of rows) {
    if (!isFinishedGroup(r.match)) continue;
    const acc = byUser.get(r.user_id) ?? { sample: 0, correct: 0 };
    acc.sample++;
    if (r.pick === r.match!.winner) acc.correct++;
    byUser.set(r.user_id, acc);
  }
  const fractions = [...byUser.values()]
    .filter((v) => v.sample > 0)
    .map((v) => v.correct / v.sample);
  return { avg: mean(fractions), n: fractions.length };
}

/** Slot → its deciding match: 'W' (champion) resolves to the Final ('F'), per score_bracket(). */
function resolveSlotMatch(slot: string, bySlot: Map<string, KnockoutMatch>) {
  return bySlot.get(slot === "W" ? "F" : slot);
}

/** Knockout-match slots that count toward accuracy (excludes 'W' champion + '3RD'). */
export function isKnockoutAccuracySlot(slot: string): boolean {
  const prefix = slot.split("-")[0];
  return prefix === "R32" || prefix === "R16" || prefix === "QF" || prefix === "SF" || prefix === "F";
}

export function bracketPickResult(
  slot: string,
  teamId: string,
  bySlot: Map<string, KnockoutMatch>,
): "correct" | "wrong" | "undecided" {
  const m = resolveSlotMatch(slot, bySlot);
  if (!m || m.status !== "FINISHED" || m.winner == null) return "undecided";
  const winningTeam =
    m.winner === "HOME" ? m.home_team_id : m.winner === "AWAY" ? m.away_team_id : null;
  if (winningTeam == null) return "undecided"; // 90-min DRAW recorded; guard
  return winningTeam === teamId ? "correct" : "wrong";
}

export function knockoutAccuracyOf(
  picks: BracketPick[],
  bySlot: Map<string, KnockoutMatch>,
): { sample: number; correct: number } {
  let sample = 0;
  let correct = 0;
  for (const p of picks) {
    if (!isKnockoutAccuracySlot(p.bracket_slot)) continue;
    const res = bracketPickResult(p.bracket_slot, p.team_id, bySlot);
    if (res === "undecided") continue;
    sample++;
    if (res === "correct") correct++;
  }
  return { sample, correct };
}

export function cohortKnockoutAccuracy(
  rows: CohortBracketPick[],
  bySlot: Map<string, KnockoutMatch>,
): { avg: number | null; n: number } {
  const byUser = new Map<string, { sample: number; correct: number }>();
  for (const r of rows) {
    if (!isKnockoutAccuracySlot(r.bracket_slot)) continue;
    const res = bracketPickResult(r.bracket_slot, r.team_id, bySlot);
    if (res === "undecided") continue;
    const acc = byUser.get(r.user_id) ?? { sample: 0, correct: 0 };
    acc.sample++;
    if (res === "correct") acc.correct++;
    byUser.set(r.user_id, acc);
  }
  const fractions = [...byUser.values()]
    .filter((v) => v.sample > 0)
    .map((v) => v.correct / v.sample);
  return { avg: mean(fractions), n: fractions.length };
}

/** Knockout rounds actually present in the data, shallowest → deepest. */
export function presentLadder(matches: KnockoutMatch[]): string[] {
  const present = new Set(matches.map((m) => m.stage));
  return KNOCKOUT_LADDER.filter((s) => present.has(s));
}

/** teamId → set of ladder rounds it WON among FINISHED knockout matches. */
export function buildStagesWonByTeam(matches: KnockoutMatch[]): Map<string, Set<string>> {
  const won = new Map<string, Set<string>>();
  for (const m of matches) {
    if (m.status !== "FINISHED" || m.winner == null) continue;
    if (!KNOCKOUT_LADDER.includes(m.stage)) continue;
    const winner = m.winner === "HOME" ? m.home_team_id : m.winner === "AWAY" ? m.away_team_id : null;
    if (winner == null) continue;
    const set = won.get(winner) ?? new Set<string>();
    set.add(m.stage);
    won.set(winner, set);
  }
  return won;
}

/** teamId → number of FINISHED knockout matches it played (for the "won N KO games" hint). */
export function buildPlayedCountByTeam(matches: KnockoutMatch[]): Map<string, number> {
  const played = new Map<string, number>();
  for (const m of matches) {
    if (m.status !== "FINISHED") continue;
    if (!KNOCKOUT_LADDER.includes(m.stage)) continue;
    for (const t of [m.home_team_id, m.away_team_id]) {
      if (t == null) continue;
      played.set(t, (played.get(t) ?? 0) + 1);
    }
  }
  return played;
}

/**
 * Bracket survival = the champion ('W') pick's rounds-won / total knockout rounds.
 * Champion (won the Final) → 1.0; lost the Final → 4/5; crashed out in R32 → 0/5 (but
 * sample ≥ 1 so still a real 0, not null). No 'W' pick or champ never played a finished
 * KO match → null.
 */
export function bracketSurvivalOf(
  champTeamId: string | null,
  wonByTeam: Map<string, Set<string>>,
  playedByTeam: Map<string, number>,
  ladder: string[],
): { value: number | null; sample: number } {
  if (!champTeamId) return { value: null, sample: 0 };
  const sample = playedByTeam.get(champTeamId) ?? 0;
  if (sample === 0 || ladder.length === 0) return { value: null, sample: 0 };
  const won = wonByTeam.get(champTeamId) ?? new Set<string>();
  const wonInLadder = ladder.filter((s) => won.has(s)).length;
  return { value: wonInLadder / ladder.length, sample };
}

export function cohortBracketSurvival(
  rows: CohortBracketPick[],
  wonByTeam: Map<string, Set<string>>,
  playedByTeam: Map<string, number>,
  ladder: string[],
): { avg: number | null; n: number } {
  const champByUser = new Map<string, string>();
  for (const r of rows) {
    if (r.bracket_slot === "W") champByUser.set(r.user_id, r.team_id);
  }
  const fractions: number[] = [];
  for (const champ of champByUser.values()) {
    const { value } = bracketSurvivalOf(champ, wonByTeam, playedByTeam, ladder);
    if (value != null) fractions.push(value);
  }
  return { avg: mean(fractions), n: fractions.length };
}

/** % of the owner's group picks (with a usable cohort) that were low-consensus. */
export function computeBoldness(
  rows: CohortMatchPick[],
  userId: string,
  maxShare: number,
): { pct: number | null; sample: number } {
  const dist = new Map<string, { total: number; HOME: number; DRAW: number; AWAY: number }>();
  const ownPickByMatch = new Map<string, Pick1X2>();
  for (const r of rows) {
    if (r.match && r.match.stage !== "GROUP") continue;
    const d = dist.get(r.match_id) ?? { total: 0, HOME: 0, DRAW: 0, AWAY: 0 };
    d.total++;
    d[r.pick]++;
    dist.set(r.match_id, d);
    if (r.user_id === userId) ownPickByMatch.set(r.match_id, r.pick);
  }
  let sample = 0;
  let bold = 0;
  for (const [matchId, pick] of ownPickByMatch) {
    const d = dist.get(matchId);
    if (!d || d.total < 2) continue; // need ≥2 cohort pickers for "consensus" to mean anything
    sample++;
    if (d[pick] / d.total < maxShare) bold++;
  }
  return { pct: sample > 0 ? Math.round((bold / sample) * 100) : null, sample };
}

/**
 * Mean lead time (kickoff − first submit) over group picks. `submitted_at` is the FIRST
 * pick time, never bumped on edit, so this is "how early did you first lock this match",
 * not the final edit time.
 */
export function avgPickLead(rows: OwnMatchPick[]): { hours: number | null; days: number | null } {
  const leads: number[] = [];
  for (const r of rows) {
    if (!r.match || r.match.stage !== "GROUP") continue;
    const lead = new Date(r.match.kickoff_at).getTime() - new Date(r.submitted_at).getTime();
    if (Number.isNaN(lead) || lead < 0) continue;
    leads.push(lead);
  }
  const avgMs = mean(leads);
  if (avgMs == null) return { hours: null, days: null };
  return { hours: avgMs / 3.6e6, days: avgMs / 8.64e7 };
}

/** Correct group picks where the winning side was ≥ margin FIFA ranks worse than the loser. */
export function countUpsets(
  rows: OwnMatchPick[],
  ranks: Map<string, number | null>,
  margin: number,
): number | null {
  let correctFinished = 0; // any correct finished pick (draw or decisive)
  let decisiveCorrect = 0; // correct + non-draw → has a winner/loser to rank
  let decisiveRanked = 0; // of those, how many had both FIFA ranks
  let upsets = 0;
  for (const r of rows) {
    const m = r.match;
    if (!isFinishedGroup(m)) continue;
    if (r.pick !== m!.winner) continue; // correct only
    correctFinished++;
    if (m!.winner === "DRAW") continue; // a correct draw is never an upset, but counts as evaluated
    decisiveCorrect++;
    const winnerTeam = m!.winner === "HOME" ? m!.home_team_id : m!.away_team_id;
    const loserTeam = m!.winner === "HOME" ? m!.away_team_id : m!.home_team_id;
    if (winnerTeam == null || loserTeam == null) continue;
    const wr = ranks.get(winnerTeam) ?? null;
    const lr = ranks.get(loserTeam) ?? null;
    if (wr == null || lr == null) continue;
    decisiveRanked++;
    if (wr - lr >= margin) upsets++; // lower rank number = stronger, so winner worse = bigger number
  }
  if (correctFinished === 0) return null; // nothing to evaluate yet (pre-tournament) → "—"
  if (decisiveCorrect > 0 && decisiveRanked === 0) return null; // rankings unseeded → can't judge
  return upsets;
}

// ─── Assembly ────────────────────────────────────────────────────────────────
function comparison(
  user: { sample: number; correct: number },
  cohort: { avg: number | null; n: number },
): ComparisonStat {
  return {
    userValue: user.sample > 0 ? user.correct / user.sample : null,
    userSample: user.sample,
    userCorrect: user.correct,
    cohortAvg: cohort.n >= 2 ? cohort.avg : null, // need ≥2 members for a real "league average"
    cohortN: cohort.n,
  };
}

/** Pure: turns fetched rows into the personality view. Testable without Supabase. */
export function computePersonality(input: PersonalityInput): PickPersonality {
  const home = input.ownMatchPicks.filter((r) => r.pick === "HOME").length;
  const draw = input.ownMatchPicks.filter((r) => r.pick === "DRAW").length;
  const away = input.ownMatchPicks.filter((r) => r.pick === "AWAY").length;
  const total = home + draw + away;

  const bySlot = new Map<string, KnockoutMatch>();
  for (const m of input.knockoutMatches) {
    if (m.bracket_slot) bySlot.set(m.bracket_slot, m);
  }
  const ladder = presentLadder(input.knockoutMatches);
  const wonByTeam = buildStagesWonByTeam(input.knockoutMatches);
  const playedByTeam = buildPlayedCountByTeam(input.knockoutMatches);

  const groupAccuracy = comparison(
    groupAccuracyOf(input.ownMatchPicks),
    cohortGroupAccuracy(input.cohortMatchPicks),
  );
  const knockoutAccuracy = comparison(
    knockoutAccuracyOf(input.ownBracketPicks, bySlot),
    cohortKnockoutAccuracy(input.cohortBracketPicks, bySlot),
  );

  const champTeamId =
    input.ownBracketPicks.find((p) => p.bracket_slot === "W")?.team_id ?? null;
  const survival = bracketSurvivalOf(champTeamId, wonByTeam, playedByTeam, ladder);
  const cohortSurvival = cohortBracketSurvival(
    input.cohortBracketPicks,
    wonByTeam,
    playedByTeam,
    ladder,
  );
  const bracketSurvival: ComparisonStat = {
    userValue: survival.value,
    userSample: survival.sample,
    userCorrect: 0, // not a "x/y" stat — UI shows "won N KO games" from userSample instead
    cohortAvg: cohortSurvival.n >= 2 ? cohortSurvival.avg : null,
    cohortN: cohortSurvival.n,
  };

  const boldness = computeBoldness(input.cohortMatchPicks, input.userId, BOLDNESS_MAX_SHARE);
  const lead = avgPickLead(input.ownMatchPicks);
  const upsetsCalled = countUpsets(input.ownMatchPicks, input.ranksByTeam, UPSET_RANK_MARGIN);

  return {
    isSelf: input.isSelf,
    pickMix: { home, draw, away, total, pct: largestRemainderPct(home, draw, away) },
    groupAccuracy,
    knockoutAccuracy,
    bracketSurvival,
    boldnessPct: boldness.pct,
    boldnessSample: boldness.sample,
    avgPickLeadHours: lead.hours,
    avgPickLeadDays: lead.days,
    upsetsCalled,
    leagueCount: input.leagueCount,
    soloCohort: input.cohortIds.length <= 1,
  };
}

function hasVisibleContent(p: PickPersonality): boolean {
  return p.pickMix.total > 0 || p.knockoutAccuracy.userSample > 0 || p.bracketSurvival.userSample > 0;
}

// ─── IO loader ───────────────────────────────────────────────────────────────
/**
 * Builds the Pick-personality view for `userId` as seen by `viewerId`. RLS-aware: runs
 * for any viewer and lets the policies scope the rows (full on your own profile; your
 * revealed picks to a league-mate after round-1 lock; nothing to a stranger). Returns
 * `null` when no content is visible, so the page simply omits the card.
 */
export async function loadPickPersonality(
  userId: string,
  viewerId?: string,
): Promise<PickPersonality | null> {
  const isSelf = !!viewerId && viewerId === userId;
  const supabase = await supabaseServer();

  const [ownMatchRes, ownBracketRes, myLeaguesRes, koMatchesRes, ranksRes] = await Promise.all([
    supabase
      .from("match_predictions")
      .select(
        "pick, submitted_at, match:matches!match_id(id, stage, kickoff_at, status, winner, home_team_id, away_team_id)",
      )
      .eq("user_id", userId),
    supabase.from("bracket_predictions").select("bracket_slot, team_id").eq("user_id", userId),
    supabase.from("league_members").select("league_id").eq("user_id", userId),
    supabase
      .from("matches")
      .select("bracket_slot, stage, status, winner, home_team_id, away_team_id")
      .neq("stage", "GROUP"),
    supabase.from("teams").select("id, fifa_ranking"),
  ]);

  const leagueIds = [...new Set((myLeaguesRes.data ?? []).map((r) => r.league_id))];

  let cohortIds: string[] = [];
  if (leagueIds.length > 0) {
    const membersRes = await supabase
      .from("league_members")
      .select("user_id")
      .in("league_id", leagueIds);
    cohortIds = [...new Set((membersRes.data ?? []).map((r) => r.user_id))];
  }

  let cohortMatchPicks: CohortMatchPick[] = [];
  let cohortBracketPicks: CohortBracketPick[] = [];
  if (cohortIds.length > 1) {
    const [cohortMatchRes, cohortBracketRes] = await Promise.all([
      supabase
        .from("match_predictions")
        .select("user_id, pick, match_id, match:matches!match_id(stage, status, winner)")
        .in("user_id", cohortIds),
      supabase
        .from("bracket_predictions")
        .select("user_id, bracket_slot, team_id")
        .in("user_id", cohortIds),
    ]);
    cohortMatchPicks = (cohortMatchRes.data ?? []) as unknown as CohortMatchPick[];
    cohortBracketPicks = (cohortBracketRes.data ?? []) as unknown as CohortBracketPick[];
  }

  const ranksByTeam = new Map<string, number | null>(
    (ranksRes.data ?? []).map((t) => [t.id, t.fifa_ranking]),
  );

  const personality = computePersonality({
    ownMatchPicks: (ownMatchRes.data ?? []) as unknown as OwnMatchPick[],
    ownBracketPicks: (ownBracketRes.data ?? []) as unknown as BracketPick[],
    knockoutMatches: (koMatchesRes.data ?? []) as unknown as KnockoutMatch[],
    ranksByTeam,
    cohortMatchPicks,
    cohortBracketPicks,
    cohortIds,
    userId,
    leagueCount: leagueIds.length,
    isSelf,
  });

  return hasVisibleContent(personality) ? personality : null;
}
