import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { supabaseServer } from "@/lib/supabase/server";
import { CreateLeagueForm } from "./CreateLeagueForm";

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
      league: m.league as LeagueRow | null,
    }))
    .filter((m): m is { role: "owner" | "member"; league: LeagueRow } => m.league !== null);

  // Member counts: fetch league_id for every member row and count client-side.
  // We tried `select("league_id, member_count:user_id.count()")` (PostgREST
  // aggregate) in PR #56 but Supabase has `db-aggregates-enabled=false` by
  // default — the aggregate request 400s, supabase-js fills `error`, data
  // comes back null, and every card fell back to the `?? 1` render default.
  // Per-row fetch is fine for a friends-only league size — leagues are tiny.
  const counts: Record<string, number> = {};
  if (leagues.length) {
    const { data: countRows, error: countError } = await supabase
      .from("league_members")
      .select("league_id")
      .in(
        "league_id",
        leagues.map((m) => m.league.id),
      );
    if (countError) {
      Sentry.captureMessage("leagues: member count query failed", {
        level: "error",
        tags: { area: "leagues", feature: "member_count" },
        extra: {
          user_id: user.id,
          pg_code: countError.code,
          pg_message: countError.message,
          pg_details: countError.details,
          pg_hint: countError.hint,
        },
      });
    }
    for (const row of countRows ?? []) {
      counts[row.league_id] = (counts[row.league_id] ?? 0) + 1;
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span
          className="badge badge-gold self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          🏟 Your leagues
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Pick your <span className="text-coral">crew</span>
        </h1>
        <p className="text-sm text-ink-soft">
          Compete in private leagues. Create one and share the invite link with friends.
        </p>
      </header>

      {leagues.length === 0 ? (
        <div className="card text-sm text-ink-soft flex flex-col gap-1">
          <p>
            You aren&rsquo;t in any leagues yet. Create one below, or open an invite link from a
            friend.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {leagues.map(({ league, role }) => (
            <Link
              key={league.id}
              href={`/leagues/${league.slug}`}
              className="card flex flex-col gap-2 hover:-translate-x-0.5 hover:-translate-y-0.5 transition-transform"
              style={{ boxShadow: "4px 4px 0 var(--ink)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display uppercase text-base tracking-wide flex items-center gap-2">
                  <span
                    className="w-7 h-7 rounded-md border-2 border-ink bg-gold flex items-center justify-center text-sm"
                    aria-hidden
                  >
                    🏆
                  </span>
                  {league.name}
                </h2>
                {role === "owner" && <span className="badge badge-pitch !text-[10px]">Owner</span>}
              </div>
              {league.description && (
                <p className="text-sm text-ink-soft line-clamp-2">{league.description}</p>
              )}
              <p className="font-mono-sticker text-[11px] text-ink-soft uppercase tracking-widest">
                👥 {counts[league.id] ?? 1} player
                {(counts[league.id] ?? 1) === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}

      <section className="card flex flex-col gap-3">
        <h2 className="font-display uppercase tracking-wide text-lg">Create a league</h2>
        <CreateLeagueForm />
      </section>
    </main>
  );
}
