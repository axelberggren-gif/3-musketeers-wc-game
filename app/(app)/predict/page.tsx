import * as Sentry from "@sentry/nextjs";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { unwrapRelation } from "@/lib/utils";
import { GroupStageList, type GroupStageMatch } from "@/components/predict/GroupStageList";
import { TournamentForm } from "@/components/predict/TournamentForm";
import { GroupWinnerPicker } from "@/components/predict/GroupWinnerPicker";
import type { TeamOption } from "@/components/predict/TeamSelect";
import { CountdownBanner } from "@/components/predict/CountdownBanner";
import type { Pick1X2 } from "@/lib/supabase/types";

const PROP_DEFS = [{ key: "first_goal_final", label: "First goal in the Final" }];

export default async function Round1Page() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const service = supabaseService();
  const [
    tournamentRes,
    matchesRes,
    picksRes,
    tpRes,
    propsRes,
    teamsRes,
    rankingsRes,
    playersRes,
    groupPicksRes,
    lastSyncRes,
  ] = await Promise.all([
    supabase.from("tournament").select("*").single(),
    supabase
      .from("matches")
      .select(
        "id, kickoff_at, group_letter, stage, home:home_team_id(id, name, short_name, code, crest_url), away:away_team_id(id, name, short_name, code, crest_url)",
      )
      .eq("stage", "GROUP")
      .order("kickoff_at", { ascending: true }),
    supabase.from("match_predictions").select("match_id, pick").eq("user_id", user.id),
    supabase
      .from("tournament_predictions")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("player_prop_predictions").select("prop_key, player_id").eq("user_id", user.id),
    // The teams catalogue is split: core columns (always present since 0001)
    // and a separate fifa_ranking fetch that is allowed to fail. Without the
    // split a missing 0005 column (e.g. `fifa_ranking`) 400s the whole query
    // and wipes every team-picker on /predict; with the split the dropdowns
    // stay populated and only the dark-horse ranking sort degrades. The
    // ranking error is still captured to Sentry so the drift is visible.
    supabase.from("teams").select("id, name, code, group_letter").order("name"),
    supabase.from("teams").select("id, fifa_ranking"),
    supabase
      .from("players")
      .select("id, name, team:team_id(name)")
      .order("name")
      .limit(1000),
    supabase
      .from("group_winner_predictions")
      .select("group_letter, team_id")
      .eq("user_id", user.id),
    service
      .from("external_sync_log")
      .select("ran_at, endpoint, status_code, message")
      .eq("source", "football-data.org")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Surface silent-empty failures of the team/player catalogue queries to
  // Sentry. `rankingsRes` is the one expected to fail when 0005 hasn't been
  // applied (warning, not error: the form still works without ranks); the
  // other two would actually break the form (error).
  if (teamsRes.error) {
    Sentry.captureMessage("predict: teams catalogue query failed", {
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
    Sentry.captureMessage("predict: teams ranking query failed", {
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
    Sentry.captureMessage("predict: players catalogue query failed", {
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
  const matches = (matchesRes.data ?? []) as unknown as GroupStageMatch[];
  const picksByMatch = Object.fromEntries(
    (picksRes.data ?? []).map((r) => [r.match_id as string, r.pick as Pick1X2]),
  ) as Record<string, Pick1X2>;
  const propPicks = Object.fromEntries(
    (propsRes.data ?? []).map((r) => [r.prop_key as string, r.player_id as string]),
  ) as Record<string, string | null>;

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
  const groupPicks = Object.fromEntries(
    (groupPicksRes.data ?? []).map((r) => [r.group_letter as string, r.team_id as string]),
  ) as Record<string, string | null>;
  const players = (playersRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    team_name: unwrapRelation(p.team as { name: string } | { name: string }[] | null)?.name ?? null,
  }));
  const lastSync = lastSyncRes.data as
    | { ran_at: string; endpoint: string; status_code: number | null; message: string | null }
    | null;

  // Tally pick coverage per group letter so we can flag complete groups with ✓.
  // The date grouping that used to live here moved into <GroupStageList /> so it
  // can re-group the filtered subset client-side when a group filter is active.
  const groupCoverage: Record<string, { picked: number; total: number }> = {};
  for (const m of matches) {
    if (!m.group_letter) continue;
    const stats = groupCoverage[m.group_letter] ?? { picked: 0, total: 0 };
    stats.total += 1;
    if (picksByMatch[m.id] != null) stats.picked += 1;
    groupCoverage[m.group_letter] = stats;
  }
  const groupLetters = Object.keys(groupCoverage).sort();
  const totalPicked = Object.keys(picksByMatch).length;
  const totalToGo = matches.length - totalPicked;

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span
          className="badge badge-coral self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          Round 1 · Group stage
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Stick your <span className="text-coral">picks</span>
        </h1>
        <p className="text-sm text-ink-soft">
          Tap a flag to commit. Picks autosave and can be changed any time before first kickoff.
        </p>
      </header>

      {tournament && (
        <CountdownBanner
          target={tournament.first_kickoff_at}
          label="Round 1 locks in"
        />
      )}

      <section className="card flex flex-col gap-4">
        <h2 className="font-display uppercase tracking-wide text-lg">
          Tournament outcomes & player props
        </h2>
        <TournamentForm
          teams={teams}
          players={players}
          initial={{
            winner_team_id: tpRes.data?.winner_team_id ?? null,
            runner_up_team_id: tpRes.data?.runner_up_team_id ?? null,
            top_scorer_player_id: tpRes.data?.top_scorer_player_id ?? null,
            dark_horse_team_id: tpRes.data?.dark_horse_team_id ?? null,
            first_eliminated_team_id:
              (tpRes.data as { first_eliminated_team_id?: string | null } | null)
                ?.first_eliminated_team_id ?? null,
            total_goals_guess:
              (tpRes.data as { total_goals_guess?: number | null } | null)?.total_goals_guess ??
              null,
            highest_match_goals_guess:
              (tpRes.data as { highest_match_goals_guess?: number | null } | null)
                ?.highest_match_goals_guess ?? null,
          }}
          propPicks={propPicks}
          propDefs={PROP_DEFS}
          locked={locks.round1Locked}
        />
      </section>

      <section className="card flex flex-col gap-4">
        <h2 className="font-display uppercase tracking-wide text-lg">
          Group winners (5 pts each)
        </h2>
        <p className="text-sm text-ink-soft">
          Pick the team you think finishes 1st in each of the 12 groups.
        </p>
        <GroupWinnerPicker
          teamsByGroup={teamsByGroup}
          initial={groupPicks}
          locked={locks.round1Locked}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-display uppercase tracking-wide text-lg">Group stage — 1X2</h2>
          <span className="font-mono-sticker text-xs text-ink-soft">
            <b className="text-pitch">{totalPicked}</b> picked ·{" "}
            <b className="text-coral">{totalToGo}</b> to go
          </span>
        </div>
        {matches.length === 0 ? (
          <div className="card flex flex-col gap-1 text-sm text-ink-soft">
            <p>
              Group-stage fixtures haven&rsquo;t been seeded yet. An admin needs to run the
              football-data sync.
            </p>
            {lastSync ? (
              <p className="font-mono-sticker text-xs">
                Last sync attempt {new Date(lastSync.ran_at).toLocaleString()} ·{" "}
                {lastSync.endpoint}
                {lastSync.status_code ? ` · HTTP ${lastSync.status_code}` : ""} ·{" "}
                {lastSync.message ?? "(no message)"}
              </p>
            ) : (
              <p className="font-mono-sticker text-xs">
                No sync has run yet — check FOOTBALL_DATA_TOKEN, CRON_SECRET, and the
                app.cron_app_url / app.cron_secret Postgres GUCs.
              </p>
            )}
          </div>
        ) : (
          <GroupStageList
            matches={matches}
            groupLetters={groupLetters}
            groupCoverage={groupCoverage}
            picksByMatch={picksByMatch}
            locked={locks.round1Locked}
          />
        )}
      </section>
    </main>
  );
}
