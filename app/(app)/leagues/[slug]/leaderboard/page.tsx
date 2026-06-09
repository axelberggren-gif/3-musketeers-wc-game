import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import type { LeagueStandingsRow } from "@/lib/supabase/types";
import type { VoteTally } from "@/lib/league-bets/shared";
import { LeaderboardLive } from "./LeaderboardLive";

export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!league) notFound();

  const [rowsRes, tournamentRes, betsRes] = await Promise.all([
    // Member-gated accessor (migration 0027) — direct SELECT on the
    // league_standings matview is revoked for authenticated users.
    supabase
      .rpc("get_league_standings", { p_league_id: league.id })
      .order("total_points", { ascending: false }),
    supabase.from("tournament").select("*").single(),
    supabase.from("league_group_bets").select("bet_kind, votee_id").eq("league_id", league.id),
  ]);
  const rows = rowsRes.data;

  // 👑 / 💩 vote tallies, revealed only once round 1 locks (RLS would only return
  // the viewer's own votes before then, so the counts would be wrong anyway).
  const tallies: Record<string, VoteTally> = {};
  if (computeLockState(tournamentRes.data).round1Locked) {
    for (const b of (betsRes.data ?? []) as Array<{ bet_kind: string; votee_id: string }>) {
      const t = (tallies[b.votee_id] ??= { crown: 0, poop: 0 });
      if (b.bet_kind === "most_points") t.crown++;
      else if (b.bet_kind === "least_points") t.poop++;
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/leagues/${slug}`}
          className="font-mono-sticker text-xs uppercase tracking-widest text-ink-soft hover:text-ink"
        >
          ← {league.name}
        </Link>
        <span
          className="badge badge-gold self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          The board
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Leaderboard
        </h1>
        <p className="text-sm text-ink-soft">
          Standings refresh as matches finish. Click any name to see their picks history.
        </p>
      </header>

      <LeaderboardLive
        leagueId={league.id}
        initialRows={(rows ?? []) as LeagueStandingsRow[]}
        currentUserId={user?.id ?? null}
        tallies={tallies}
      />
    </main>
  );
}
