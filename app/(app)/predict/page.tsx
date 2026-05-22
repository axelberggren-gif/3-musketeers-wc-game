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

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="badge w-fit">Round 1 · Pre-tournament</span>
        <h1 className="text-3xl font-bold">Group stage + tournament picks</h1>
        <p className="text-sm text-[var(--muted)]">
          Pick 1X2 for every group match plus tournament-wide bets: winner, runner-up, golden
          boot, dark horse, total goals, group winners, troublemaker, first team out and more.
          All picks autosave and can be changed any time before first kickoff.
        </p>
      </header>

      {tournament && (
        <CountdownBanner target={tournament.first_kickoff_at} label="Round 1 locks at first kickoff" />
      )}

      <section className="card flex flex-col gap-4">
        <h2 className="font-semibold">Tournament outcomes &amp; player props</h2>
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
        <h2 className="font-semibold">Group winners (5 pts each)</h2>
        <p className="text-sm text-[var(--muted)]">
          Pick the team you think finishes 1st in each of the 12 groups.
        </p>
        <GroupWinnerPicker
          teamsByGroup={teamsByGroup}
          initial={groupPicks}
          locked={locks.round1Locked}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Group stage — 1X2</h2>
          <span className="text-sm text-[var(--muted)]">{matches.length} matches</span>
        </div>
        {matches.length === 0 && (
          <div className="flex flex-col gap-1 text-sm text-[var(--muted)]">
            <p>
              Group-stage fixtures haven&rsquo;t been seeded yet. An admin needs to run the
              football-data sync.
            </p>
            {lastSync ? (
              <p className="font-mono text-xs">
                Last sync attempt {new Date(lastSync.ran_at).toLocaleString()} ·{" "}
                {lastSync.endpoint}
                {lastSync.status_code ? ` · HTTP ${lastSync.status_code}` : ""} ·{" "}
                {lastSync.message ?? "(no message)"}
              </p>
            ) : (
              <p className="font-mono text-xs">
                No sync has run yet — check FOOTBALL_DATA_TOKEN, CRON_SECRET, and the
                app.cron_app_url / app.cron_secret Postgres GUCs.
              </p>
            )}
          </div>
        )}
        {Object.entries(grouped).map(([date, group]) => (
          <div key={date} className="flex flex-col gap-3">
            <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">{date}</h3>
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
