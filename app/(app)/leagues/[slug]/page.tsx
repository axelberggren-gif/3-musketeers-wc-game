import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { CountryFlag } from "@/components/CountryFlag";
import { isoToLocal, unwrapRelation } from "@/lib/utils";
import { Trophy, ListOrdered, Users } from "lucide-react";

export default async function LeagueHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, description, owner_id, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!league) notFound();

  const [standingsRes, upcomingRes, recentRes] = await Promise.all([
    supabase
      .from("league_standings")
      .select("*")
      .eq("league_id", league.id)
      .order("total_points", { ascending: false })
      .limit(5),
    supabase
      .from("matches")
      .select(
        "id, kickoff_at, stage, group_letter, status, home:home_team_id(name, code, crest_url), away:away_team_id(name, code, crest_url)",
      )
      .gt("kickoff_at", new Date().toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(5),
    supabase
      .from("matches")
      .select(
        "id, kickoff_at, stage, group_letter, status, home_score, away_score, home:home_team_id(name, code, crest_url), away:away_team_id(name, code, crest_url)",
      )
      .eq("status", "FINISHED")
      .order("kickoff_at", { ascending: false })
      .limit(5),
  ]);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span className="badge w-fit">League</span>
        <h1 className="text-3xl font-bold">{league.name}</h1>
        {league.description && (
          <p className="text-sm text-[var(--muted)]">{league.description}</p>
        )}
        <div className="flex gap-2 mt-2">
          <Link href={`/leagues/${slug}/leaderboard`} className="btn btn-secondary">
            <ListOrdered className="w-4 h-4" /> Leaderboard
          </Link>
          <Link href={`/leagues/${slug}/members`} className="btn btn-secondary">
            <Users className="w-4 h-4" /> Members
          </Link>
        </div>
      </header>

      <section className="card flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[var(--accent)]" /> Top 5
          </h2>
          <Link
            href={`/leagues/${slug}/leaderboard`}
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            See full board →
          </Link>
        </div>
        {(standingsRes.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No points awarded yet. Standings populate as matches finish.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-[var(--border)]">
            {(standingsRes.data ?? []).map((row, idx) => (
              <li key={row.user_id} className="flex items-center justify-between py-2">
                <span className="flex items-center gap-3">
                  <span className="text-[var(--muted)] w-6 text-right">{idx + 1}</span>
                  <Link
                    href={`/profile/${row.username}`}
                    className="font-medium hover:text-[var(--accent)]"
                  >
                    {row.display_name ?? row.username}
                  </Link>
                </span>
                <span className="font-mono">{row.total_points}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">Upcoming matches</h2>
          {(upcomingRes.data ?? []).length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No upcoming matches.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {upcomingRes.data!.map((m) => (
                <MatchRow key={m.id} match={m} />
              ))}
            </ul>
          )}
        </section>
        <section className="card flex flex-col gap-3">
          <h2 className="font-semibold">Recent results</h2>
          {(recentRes.data ?? []).length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No matches finished yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {recentRes.data!.map((m) => (
                <MatchRow key={m.id} match={m} showScore />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

type MatchTeam = { name: string; code: string; crest_url: string | null } | null;
type MatchRowData = {
  id: string;
  kickoff_at: string;
  group_letter: string | null;
  stage: string;
  status: string;
  home: MatchTeam | MatchTeam[];
  away: MatchTeam | MatchTeam[];
  home_score?: number | null;
  away_score?: number | null;
};

function MatchRow({ match, showScore }: { match: MatchRowData; showScore?: boolean }) {
  const home = unwrapRelation(match.home);
  const away = unwrapRelation(match.away);
  return (
    <li className="py-2.5 flex items-center gap-3">
      <Link href={`/match/${match.id}`} className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <CountryFlag crestUrl={home?.crest_url} code={home?.code} name={home?.name ?? "TBD"} size={24} />
          <span className="text-sm truncate">{home?.name ?? "TBD"}</span>
        </div>
        <span className="text-xs text-[var(--muted)] tabular-nums w-16 text-center">
          {showScore ? `${match.home_score ?? "–"} : ${match.away_score ?? "–"}` : "vs"}
        </span>
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
          <span className="text-sm truncate">{away?.name ?? "TBD"}</span>
          <CountryFlag crestUrl={away?.crest_url} code={away?.code} name={away?.name ?? "TBD"} size={24} />
        </div>
      </Link>
      <span className="text-xs text-[var(--muted)] w-24 text-right">
        {isoToLocal(match.kickoff_at, { weekday: undefined, year: undefined })}
      </span>
    </li>
  );
}
