import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { CountryFlag } from "@/components/CountryFlag";
import { isoToLocal } from "@/lib/utils";
import { BanterFeed } from "@/components/banter/BanterFeed";
import type { BanterMessage, BanterReply } from "@/lib/supabase/types";
import type { ProfileLite } from "@/components/banter/BanterMessage";

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

  const [standingsRes, upcomingRes, recentRes, messagesRes, membersRes] = await Promise.all([
    supabase
      .from("league_standings")
      .select("*")
      .eq("league_id", league.id)
      .order("total_points", { ascending: false })
      .limit(5),
    supabase
      .from("matches")
      .select(
        "id, kickoff_at, stage, group_letter, status, home:teams!home_team_id(name, code, crest_url), away:teams!away_team_id(name, code, crest_url)",
      )
      .gt("kickoff_at", new Date().toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(5),
    supabase
      .from("matches")
      .select(
        "id, kickoff_at, stage, group_letter, status, home_score, away_score, home:teams!home_team_id(name, code, crest_url), away:teams!away_team_id(name, code, crest_url)",
      )
      .eq("status", "FINISHED")
      .order("kickoff_at", { ascending: false })
      .limit(5),
    supabase
      .from("banter_messages")
      .select("id, league_id, user_id, body, created_at")
      .eq("league_id", league.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("league_members")
      .select("user_id, profile:user_id(username, display_name)")
      .eq("league_id", league.id),
  ]);

  const messagesDesc = (messagesRes.data ?? []) as BanterMessage[];
  // Ascending order for state; render layer re-sorts descending.
  const initialMessages = [...messagesDesc].reverse();
  const messageIds = initialMessages.map((m) => m.id);

  const repliesRes = messageIds.length
    ? await supabase
        .from("banter_replies")
        .select("id, message_id, user_id, body, created_at")
        .in("message_id", messageIds)
        .order("created_at", { ascending: true })
    : { data: [] as BanterReply[] };

  const initialReplies: Record<string, BanterReply[]> = {};
  for (const r of (repliesRes.data ?? []) as BanterReply[]) {
    (initialReplies[r.message_id] ??= []).push(r);
  }

  const profilesById: Record<string, ProfileLite> = {};
  for (const row of (membersRes.data ?? []) as Array<{
    user_id: string;
    profile: ProfileLite | null;
  }>) {
    if (row.profile) profilesById[row.user_id] = row.profile;
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span
          className="badge badge-gold self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          Private league
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          {league.name}
        </h1>
        {league.description && (
          <p className="text-sm text-ink-soft">{league.description}</p>
        )}
        <div className="flex gap-2 flex-wrap mt-1">
          <Link href={`/leagues/${slug}/leaderboard`} className="btn btn-primary btn-sm">
            🏆 Leaderboard
          </Link>
          <Link href={`/leagues/${slug}/members`} className="btn btn-secondary btn-sm">
            👥 Members
          </Link>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1.8fr_1fr] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <section className="card flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display uppercase tracking-wide text-base flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded-md bg-gold border-2 border-ink inline-flex items-center justify-center text-xs"
                  aria-hidden
                >
                  🏆
                </span>
                Top 5
              </h2>
              <Link
                href={`/leagues/${slug}/leaderboard`}
                className="font-mono-sticker text-xs text-ink-soft hover:text-ink uppercase tracking-widest"
              >
                See full board →
              </Link>
            </div>
            {(standingsRes.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">
                No points awarded yet. Standings populate as matches finish.
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {(standingsRes.data ?? []).map((row, idx) => (
                  <li
                    key={row.user_id}
                    className="flex items-center justify-between gap-2 rounded-lg border-2 border-ink bg-paper-2 px-3 py-2"
                    style={{ boxShadow: "2px 2px 0 var(--ink)" }}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className={[
                          "inline-flex items-center justify-center w-8 h-8 rounded-md border-2 border-ink font-display text-sm",
                          idx === 0
                            ? "bg-gold"
                            : idx === 1
                              ? "bg-paper"
                              : idx === 2
                                ? "bg-coral text-white"
                                : "bg-white",
                        ].join(" ")}
                      >
                        {idx + 1}
                      </span>
                      <Link
                        href={`/profile/${row.username}`}
                        className="font-display uppercase text-sm tracking-wide hover:text-coral"
                      >
                        {row.display_name ?? row.username}
                      </Link>
                    </span>
                    <span className="font-display text-xl tabular-nums">{row.total_points}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="card flex flex-col gap-3">
              <h2 className="font-display uppercase tracking-wide text-base">Upcoming matches</h2>
              {(upcomingRes.data ?? []).length === 0 ? (
                <p className="text-sm text-ink-soft">No upcoming matches.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {upcomingRes.data!.map((m) => (
                    <MatchRow key={m.id} match={m} />
                  ))}
                </ul>
              )}
            </section>
            <section className="card flex flex-col gap-3">
              <h2 className="font-display uppercase tracking-wide text-base">Recent results</h2>
              {(recentRes.data ?? []).length === 0 ? (
                <p className="text-sm text-ink-soft">No matches finished yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {recentRes.data!.map((m) => (
                    <MatchRow key={m.id} match={m} showScore />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>

        <aside className="flex flex-col gap-6 min-w-0">
          <BanterFeed
            leagueId={league.id}
            currentUserId={user.id}
            initialMessages={initialMessages}
            initialReplies={initialReplies}
            profilesById={profilesById}
          />
        </aside>
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
  home: MatchTeam;
  away: MatchTeam;
  home_score?: number | null;
  away_score?: number | null;
};

function MatchRow({ match, showScore }: { match: MatchRowData; showScore?: boolean }) {
  const home = match.home;
  const away = match.away;
  return (
    <li
      className="rounded-lg border-2 border-ink bg-paper-2 px-3 py-2 flex items-center gap-2"
      style={{ boxShadow: "2px 2px 0 var(--ink)" }}
    >
      <Link href={`/match/${match.id}`} className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <CountryFlag
            crestUrl={home?.crest_url}
            code={home?.code}
            name={home?.name ?? "TBD"}
            size={24}
          />
          <span className="text-sm font-medium truncate">{home?.name ?? "TBD"}</span>
        </div>
        <span className="font-mono-sticker text-xs text-ink-soft tabular-nums w-16 text-center">
          {showScore ? `${match.home_score ?? "–"} : ${match.away_score ?? "–"}` : "vs"}
        </span>
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
          <span className="text-sm font-medium truncate">{away?.name ?? "TBD"}</span>
          <CountryFlag
            crestUrl={away?.crest_url}
            code={away?.code}
            name={away?.name ?? "TBD"}
            size={24}
          />
        </div>
      </Link>
      <span className="font-mono-sticker text-[10px] text-ink-soft w-20 text-right uppercase tracking-widest">
        {isoToLocal(match.kickoff_at, { weekday: undefined, year: undefined })}
      </span>
    </li>
  );
}
