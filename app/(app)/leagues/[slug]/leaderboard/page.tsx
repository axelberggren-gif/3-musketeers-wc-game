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
    <main className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/leagues/${slug}`} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          ← {league.name}
        </Link>
        <h1 className="text-3xl font-bold">Leaderboard</h1>
        <p className="text-sm text-[var(--muted)]">
          Standings refresh as matches finish. Click any name to see their picks history.
        </p>
      </header>

      <LeaderboardLive leagueId={league.id} initialRows={rows ?? []} />
    </main>
  );
}
