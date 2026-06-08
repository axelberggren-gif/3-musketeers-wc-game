import * as Sentry from "@sentry/nextjs";
import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { OutcomesBoard } from "@/components/predict/OutcomesBoard";
import type { TeamOption } from "@/components/predict/TeamSelect";
import { CountdownBanner } from "@/components/predict/CountdownBanner";

const PROP_DEFS = [{ key: "first_goal_final", label: "First goal in the Final" }];

type PredictClient = Awaited<ReturnType<typeof supabaseServer>>;
type PlayerRow = { id: string; name: string; team: { name: string } | null };

// The players catalogue is ~1,100+ rows for WC 2026 (48 teams × full squads),
// which exceeds PostgREST's default page size. A single `.limit(1000)` silently
// truncated the player pickers alphabetically (~"O"), so we range-paginate
// through every player instead. Ordering by (name, id) keeps the pagination
// stable even when two players share a name. Returns the same `{ data, error }`
// shape as a plain query so the existing Sentry capture and the downstream
// `playersRes.data` mapping stay unchanged.
async function fetchAllPlayers(client: PredictClient) {
  const pageSize = 1000;
  const all: PlayerRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("players")
      .select("id, name, team:team_id(name)")
      .order("name")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all.push(...((data ?? []) as unknown as PlayerRow[]));
    if (!data || data.length < pageSize) break;
  }
  return { data: all, error: null };
}

export default async function OutcomesPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [tournamentRes, tpRes, propsRes, teamsRes, rankingsRes, playersRes, groupPicksRes] =
    await Promise.all([
      supabase.from("tournament").select("*").single(),
      supabase.from("tournament_predictions").select("*").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("player_prop_predictions")
        .select("prop_key, player_id")
        .eq("user_id", user.id),
      // The teams catalogue is split: core columns (always present since 0001)
      // and a separate fifa_ranking fetch that is allowed to fail. Without the
      // split a missing 0005 column (e.g. `fifa_ranking`) 400s the whole query
      // and wipes every team-picker; with the split the dropdowns stay populated
      // and only the dark-horse ranking sort degrades. The ranking error is
      // still captured to Sentry so the drift is visible.
      supabase.from("teams").select("id, name, code, group_letter").order("name"),
      supabase.from("teams").select("id, fifa_ranking"),
      fetchAllPlayers(supabase),
      supabase
        .from("group_winner_predictions")
        .select("group_letter, team_id")
        .eq("user_id", user.id),
    ]);

  // Surface silent-empty failures of the team/player catalogue queries to
  // Sentry. `rankingsRes` is the one expected to fail when 0005 hasn't been
  // applied (warning, not error: the form still works without ranks); the other
  // two would actually break the form (error).
  if (teamsRes.error) {
    Sentry.captureMessage("outcomes: teams catalogue query failed", {
      level: "error",
      tags: { area: "predict", feature: "tournament_predictions" },
      extra: {
        user_id: user.id,
        pg_code: teamsRes.error.code,
        pg_message: teamsRes.error.message,
        pg_details: teamsRes.error.details,
        pg_hint: teamsRes.error.hint,
      },
    });
  }
  if (rankingsRes.error) {
    Sentry.captureMessage("outcomes: teams ranking query failed", {
      level: "warning",
      tags: { area: "predict", feature: "tournament_predictions" },
      extra: {
        user_id: user.id,
        pg_code: rankingsRes.error.code,
        pg_message: rankingsRes.error.message,
        pg_details: rankingsRes.error.details,
        pg_hint: rankingsRes.error.hint,
      },
    });
  }
  if (playersRes.error) {
    Sentry.captureMessage("outcomes: players catalogue query failed", {
      level: "error",
      tags: { area: "predict", feature: "tournament_predictions" },
      extra: {
        user_id: user.id,
        pg_code: playersRes.error.code,
        pg_message: playersRes.error.message,
        pg_details: playersRes.error.details,
        pg_hint: playersRes.error.hint,
      },
    });
  }

  const rankingByTeamId = new Map<string, number | null>(
    (rankingsRes.data ?? []).map((r) => [
      r.id as string,
      (r as { fifa_ranking?: number | null }).fifa_ranking ?? null,
    ]),
  );

  const tournament = tournamentRes.data;
  const locks = computeLockState(tournament);

  const teams: TeamOption[] = (teamsRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    fifa_ranking: rankingByTeamId.get(t.id) ?? null,
  }));
  const teamsByGroup: Record<string, TeamOption[]> = {};
  for (const t of teamsRes.data ?? []) {
    const letter = (t as { group_letter?: string | null }).group_letter ?? null;
    if (!letter) continue;
    (teamsByGroup[letter] ??= []).push({
      id: t.id,
      name: t.name,
      code: t.code,
      fifa_ranking: rankingByTeamId.get(t.id) ?? null,
    });
  }
  const players = (playersRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    team_name: (p.team as { name: string } | null)?.name ?? null,
  }));
  const propPicks = Object.fromEntries(
    (propsRes.data ?? []).map((r) => [r.prop_key as string, r.player_id as string]),
  ) as Record<string, string | null>;
  const groupPicks = Object.fromEntries(
    (groupPicksRes.data ?? []).map((r) => [r.group_letter as string, r.team_id as string]),
  ) as Record<string, string | null>;

  const tp = tpRes.data;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span
          className="badge badge-coral self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          Round 1 · Outright bets
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Call the <span className="text-coral">big ones</span>
        </h1>
        <p className="text-sm text-ink-soft">
          Your tournament-long betting slip — winner, golden boot, the over/unders and the
          wildcards. Everything here locks at the first kickoff and scores itself as the World Cup
          unfolds.
        </p>
      </header>

      {tournament && !locks.round1Locked && (
        <CountdownBanner target={tournament.first_kickoff_at} label="Outright bets lock in" />
      )}

      <OutcomesBoard
        teams={teams}
        players={players}
        teamsByGroup={teamsByGroup}
        initial={{
          winner_team_id: tp?.winner_team_id ?? null,
          runner_up_team_id: tp?.runner_up_team_id ?? null,
          top_scorer_player_id: tp?.top_scorer_player_id ?? null,
          dark_horse_team_id: tp?.dark_horse_team_id ?? null,
          first_eliminated_team_id: tp?.first_eliminated_team_id ?? null,
          total_goals_guess: tp?.total_goals_guess ?? null,
          highest_match_goals_guess: tp?.highest_match_goals_guess ?? null,
          final_goals_guess: tp?.final_goals_guess ?? null,
          biggest_win_margin_guess: tp?.biggest_win_margin_guess ?? null,
          golden_boot_goals_guess: tp?.golden_boot_goals_guess ?? null,
          total_red_cards_guess: tp?.total_red_cards_guess ?? null,
        }}
        propPicks={propPicks}
        propDefs={PROP_DEFS}
        groupPicks={groupPicks}
        locked={locks.round1Locked}
      />
    </main>
  );
}
