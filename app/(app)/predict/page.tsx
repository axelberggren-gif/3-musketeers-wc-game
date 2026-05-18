import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { MatchPickCard, type MatchPickRow } from "@/components/predict/MatchPickCard";
import { TournamentForm } from "@/components/predict/TournamentForm";
import { CountdownBanner } from "@/components/predict/CountdownBanner";
import type { Pick1X2 } from "@/lib/supabase/types";

const PROP_DEFS = [{ key: "first_goal_final", label: "First goal in the Final" }];

export default async function Round1Page() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [tournamentRes, matchesRes, picksRes, tpRes, propsRes, teamsRes, playersRes] =
    await Promise.all([
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
      supabase.from("teams").select("id, name, code").order("name"),
      supabase
        .from("players")
        .select("id, name, team:team_id(name)")
        .order("name")
        .limit(1000),
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

  const teams = (teamsRes.data ?? []).map((t) => ({ id: t.id, name: t.name, code: t.code }));
  const players = (playersRes.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    team_name: (Array.isArray(p.team) ? p.team[0] : p.team)?.name ?? null,
  }));

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
          Pick 1X2 for every group match, the winner, runner-up, golden boot and dark horse. All
          picks autosave and can be changed any time before first kickoff.
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
          }}
          propPicks={propPicks}
          propDefs={PROP_DEFS}
          locked={locks.round1Locked}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Group stage — 1X2</h2>
          <span className="text-sm text-[var(--muted)]">{matches.length} matches</span>
        </div>
        {matches.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            Group-stage fixtures haven&rsquo;t been seeded yet. An admin needs to run the
            football-data sync.
          </p>
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
