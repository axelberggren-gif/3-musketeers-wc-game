import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
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

  const { data: rows } = await supabase
    .from("league_standings")
    .select("*")
    .eq("league_id", league.id)
    .order("total_points", { ascending: false });

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
        initialRows={rows ?? []}
        currentUserId={user?.id ?? null}
      />
    </main>
  );
}
