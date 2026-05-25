import * as Sentry from "@sentry/nextjs";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { unwrapRelation } from "@/lib/utils";
import { MatchPickCard, type MatchPickRow } from "@/components/predict/MatchPickCard";
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
    supabase.from("teams").select("id, name, code, group_letter, fifa_ranking").order("name"),
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

  // Surface silent-empty failures of the team/player catalogue queries. The most
  // common cause is a migration not yet applied to the target DB (e.g. 0005's
  // teams.fifa_ranking column) — PostgREST returns 400 and supabase-js fills
  // `error` while data stays null, the `?? []` coalesces below empty out every
  // picker, and the user sees blank dropdowns with no signal in the logs.
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

  const tournament = tournamentRes.data;
  const locks = computeLockState(tournament);
  const matches = (matchesRes.data ?? []) as unknown as Array<{
    id: string;
    kickoff_at: string;
    group_letter: string | null;
    home: MatchPickRow["home"];
    away: MatchPickRow["away"];
  }>;
  const picksByMatch = new Map<string, Pick1X2>(
    (picksRes.data ?? []).map((r) => [r.match_id as string, r.pick as Pick1X2]),
  );
  const propPicks = Object.fromEntries(
    (propsRes.data ?? []).map((r) => [r.prop_key as string, r.player_id as string]),
  ) as Record<string, string | null>;

  const teams: TeamOption[] = (teamsRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    fifa_ranking: (t as { fifa_ranking?: number | null }).fifa_ranking ?? null,
  }));
  const teamsByGroup: Record<string, TeamOption[]> = {};
  for (const t of teamsRes.data ?? []) {
    const letter = (t as { group_letter?: string | null }).group_letter ?? null;
    if (!letter) continue;
    (teamsByGroup[letter] ??= []).push({
      id: t.id,
      name: t.name,
      code: t.code,
      fifa_ranking: (t as { fifa_ranking?: number | null }).fifa_ranking ?? null,
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

  // Group matches by date for nicer layout
  const grouped = matches.reduce<Record<string, typeof matches>>((acc, m) => {
    const date = new Date(m.kickoff_at).toDateString();
    (acc[date] ??= []).push(m);
    return acc;
  }, {});

  // Tally pick coverage per group letter so we can flag complete groups with ✓.
  const groupCoverage = new Map<string, { picked: number; total: number }>();
  for (const m of matches) {
    if (!m.group_letter) continue;
    const stats = groupCoverage.get(m.group_letter) ?? { picked: 0, total: 0 };
    stats.total += 1;
    if (picksByMatch.has(m.id)) stats.picked += 1;
    groupCoverage.set(m.group_letter, stats);
  }
  const groupLetters = Array.from(groupCoverage.keys()).sort();
  const totalPicked = picksByMatch.size;
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
        {groupLetters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {groupLetters.map((g) => {
              const stats = groupCoverage.get(g)!;
              const complete = stats.picked === stats.total && stats.total > 0;
              return (
                <span
                  key={g}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border-2 border-ink font-display uppercase text-[11px] tracking-wider px-3 py-1",
                    complete ? "bg-pitch text-white" : "bg-white text-ink",
                  ].join(" ")}
                  style={{ boxShadow: complete ? "3px 3px 0 var(--ink)" : "3px 3px 0 var(--ink)" }}
                >
                  Group {g}
                  {complete ? <span aria-label="complete">✓</span> : (
                    <span className="font-mono-sticker text-[10px] text-ink-soft normal-case">
                      {stats.picked}/{stats.total}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
        {matches.length === 0 && (
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
        )}
        {Object.entries(grouped).map(([date, group]) => (
          <div key={date} className="flex flex-col gap-3">
            <h3 className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft font-medium">
              {date}
            </h3>
            <div className="grid md:grid-cols-2 gap-3">
              {group.map((m) => (
                <MatchPickCard
                  key={m.id}
                  match={{
                    id: m.id,
                    kickoff_at: m.kickoff_at,
                    group_letter: m.group_letter,
                    home: m.home,
                    away: m.away,
                  }}
                  initialPick={picksByMatch.get(m.id) ?? null}
                  locked={locks.round1Locked}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
