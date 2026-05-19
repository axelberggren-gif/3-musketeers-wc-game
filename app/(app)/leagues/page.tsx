import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { unwrapRelation } from "@/lib/utils";
import { CreateLeagueForm } from "./CreateLeagueForm";
import { Trophy, Users } from "lucide-react";

export default async function LeaguesPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: memberships } = await supabase
    .from("league_members")
    .select("role, league:league_id(id, slug, name, description, owner_id)")
    .eq("user_id", user.id);

  type LeagueRow = {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    owner_id: string;
  };
  const leagues = (memberships ?? [])
    .map((m) => ({
      role: m.role as "owner" | "member",
      league: unwrapRelation(m.league as LeagueRow | LeagueRow[] | null),
    }))
    .filter((m): m is { role: "owner" | "member"; league: LeagueRow } => m.league !== null);

  const counts: Record<string, number> = {};
  if (leagues.length) {
    const { data: countRows } = await supabase
      .from("league_members")
      .select("league_id")
      .in(
        "league_id",
        leagues.map((m) => m.league.id),
      );
    for (const row of countRows ?? []) {
      counts[row.league_id as string] = (counts[row.league_id as string] ?? 0) + 1;
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Your leagues</h1>
        <p className="text-sm text-[var(--muted)]">
          Compete in private leagues. Create one and share the invite link.
        </p>
      </header>

      {leagues.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">
          You aren&rsquo;t in any leagues yet. Create one below, or open an invite link from a
          friend.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {leagues.map(({ league, role }) => (
            <Link
              key={league.id}
              href={`/leagues/${league.slug}`}
              className="card flex flex-col gap-2 hover:border-[var(--accent)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-[var(--accent)]" /> {league.name}
                </h2>
                {role === "owner" && <span className="badge">Owner</span>}
              </div>
              {league.description && (
                <p className="text-sm text-[var(--muted)] line-clamp-2">{league.description}</p>
              )}
              <p className="text-xs text-[var(--muted)] flex items-center gap-1">
                <Users className="w-3 h-3" /> {counts[league.id] ?? 1} member
                {(counts[league.id] ?? 1) === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">Create a league</h2>
        <CreateLeagueForm />
      </section>
    </main>
  );
}
