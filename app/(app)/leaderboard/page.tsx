import { supabaseServer } from "@/lib/supabase/server";
import type { GlobalStandingsRow } from "@/lib/supabase/types";
import { GlobalLeaderboardLive } from "./GlobalLeaderboardLive";

export default async function GlobalLeaderboardPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Live aggregation across all leagues (migration 0031). Sums each player's
  // global (league_id IS NULL) awards; only users who've scored are returned.
  const { data: rows } = await supabase
    .rpc("get_global_standings")
    .order("total_points", { ascending: false });

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <span
          className="badge badge-gold self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          The whole portal
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Global leaderboard
        </h1>
        <p className="text-sm text-ink-soft">
          Every player ranked by total points, across all leagues. Standings refresh as
          matches finish — click any name to see their picks history.
        </p>
      </header>

      <GlobalLeaderboardLive
        initialRows={(rows ?? []) as GlobalStandingsRow[]}
        currentUserId={user?.id ?? null}
      />
    </main>
  );
}
