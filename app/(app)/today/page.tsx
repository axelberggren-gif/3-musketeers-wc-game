import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { loadGroupStagePicks } from "@/lib/stats/group-picks";
import { rankAgreement, recentForm } from "@/lib/stats/league-pulse";
import { loadBanter } from "@/lib/banter/load";
import { BanterFeed } from "@/components/banter/BanterFeed";
import { TodayBoard, type TodayMember } from "@/components/today/TodayBoard";
import { LeagueSwitcher } from "@/components/today/LeagueSwitcher";
import {
  LeaguePulse,
  type PulseAgreementRow,
  type PulseFormRow,
} from "@/components/today/LeaguePulse";
import type { ProfileLite } from "@/components/banter/BanterMessage";

type LeagueLite = { id: string; slug: string; name: string };
type MemberRow = {
  user_id: string;
  profile: { username: string; display_name: string | null } | null;
};

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string }>;
}) {
  const { league: leagueParam } = await searchParams;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("league_members")
    .select("joined_at, league:league_id(id, slug, name)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  const myLeagues = (memberships ?? [])
    .map((m) => m.league as LeagueLite | null)
    .filter((l): l is LeagueLite => l !== null);

  if (myLeagues.length === 0) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
        <Header />
        <div className="card flex flex-col gap-2 text-sm text-ink-soft">
          <p>
            Today is your league&rsquo;s matchday hub — but you aren&rsquo;t in a league
            yet.
          </p>
          <Link href="/leagues" className="btn btn-coral self-start">
            Join or create a league →
          </Link>
        </div>
      </main>
    );
  }

  const league = myLeagues.find((l) => l.slug === leagueParam) ?? myLeagues[0];

  const [membersRes, tournamentRes, standingsRes, banter] = await Promise.all([
    supabase
      .from("league_members")
      .select("user_id, profile:user_id(username, display_name)")
      .eq("league_id", league.id),
    supabase.from("tournament").select("*").single(),
    supabase
      .rpc("get_league_standings", { p_league_id: league.id })
      .order("total_points", { ascending: false })
      .limit(5),
    loadBanter(league.id),
  ]);

  const memberRows = (membersRes.data ?? []) as MemberRow[];
  const profilesById: Record<string, ProfileLite> = {};
  for (const row of memberRows) {
    if (row.profile) profilesById[row.user_id] = row.profile;
  }

  const members: TodayMember[] = memberRows
    .filter((m) => m.profile !== null)
    .map((m) => ({
      id: m.user_id,
      username: m.profile!.username,
      label: m.profile!.display_name ?? m.profile!.username,
    }))
    .sort((a, b) =>
      a.id === user.id ? -1 : b.id === user.id ? 1 : a.label.localeCompare(b.label),
    );

  const { matches, picksByUser } = await loadGroupStagePicks(members.map((m) => m.id));
  const locks = computeLockState(tournamentRes.data);

  const memberById = new Map(members.map((m) => [m.id, m]));
  const agreement: PulseAgreementRow[] = rankAgreement(user.id, picksByUser)
    .map((row) => {
      const member = memberById.get(row.userId);
      return member
        ? { username: member.username, label: member.label, both: row.both, same: row.same }
        : null;
    })
    .filter((r): r is PulseAgreementRow => r !== null);

  const form: PulseFormRow[] = members.map((m) => {
    const summary = recentForm(matches, picksByUser[m.id] ?? {});
    return {
      username: m.username,
      label: m.label,
      isSelf: m.id === user.id,
      dots: summary.dots,
      streak: summary.streak,
    };
  });

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <Header>
        {myLeagues.length > 1 ? (
          <LeagueSwitcher
            options={myLeagues.map((l) => ({ slug: l.slug, name: l.name }))}
            active={league.slug}
          />
        ) : (
          <Link
            href={`/leagues/${league.slug}`}
            className="badge badge-gold self-start"
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            🏆 {league.name}
          </Link>
        )}
      </Header>

      <div className="grid lg:grid-cols-[1.8fr_1fr] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <TodayBoard
            matches={matches}
            picksByUser={picksByUser}
            members={members}
            selfId={user.id}
            revealed={locks.round1Locked}
            serverNowIso={new Date().toISOString()}
          />
          {locks.round1Locked ? (
            <LeaguePulse agreement={agreement} form={form} />
          ) : (
            <section className="card text-sm text-ink-soft">
              <p>
                📊 League stats — twins &amp; opposites, form streaks — appear once the
                tournament kicks off and everyone&rsquo;s picks are revealed.
              </p>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-6 min-w-0">
          <section className="card flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display uppercase tracking-wide text-base flex items-center gap-2">
                <span aria-hidden>🏆</span> Top 5
              </h2>
              <Link
                href={`/leagues/${league.slug}/leaderboard`}
                className="font-mono-sticker text-xs text-ink-soft hover:text-ink uppercase tracking-widest"
              >
                Full board →
              </Link>
            </div>
            {(standingsRes.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-soft">
                No points yet. Standings populate as matches finish.
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {(standingsRes.data ?? []).map((row, idx) => (
                  <li
                    key={row.user_id}
                    className="flex items-center justify-between gap-2 rounded-lg border-2 border-ink bg-paper-2 px-3 py-2"
                    style={{ boxShadow: "2px 2px 0 var(--ink)" }}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={[
                          "inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-md border-2 border-ink font-display text-xs",
                          idx === 0 ? "bg-gold" : idx === 2 ? "bg-coral text-white" : "bg-white",
                        ].join(" ")}
                      >
                        {idx + 1}
                      </span>
                      <Link
                        href={`/profile/${row.username}`}
                        className="font-display uppercase text-xs tracking-wide truncate hover:text-coral"
                      >
                        {row.display_name ?? row.username}
                      </Link>
                    </span>
                    <span className="font-display text-base tabular-nums">
                      {row.total_points}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <BanterFeed
            leagueId={league.id}
            currentUserId={user.id}
            initialMessages={banter.initialMessages}
            initialReplies={banter.initialReplies}
            profilesById={profilesById}
          />
        </aside>
      </div>
    </main>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3">
      <span
        className="badge badge-coral self-start -rotate-2"
        style={{ boxShadow: "3px 3px 0 var(--ink)" }}
      >
        📅 Matchday
      </span>
      <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
        Today<span className="text-coral">.</span>
      </h1>
      <p className="text-sm text-ink-soft">
        The league&rsquo;s daily pulse — today&rsquo;s matches, everyone&rsquo;s calls,
        and the banter to go with them.
      </p>
      {children}
    </header>
  );
}
