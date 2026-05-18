import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { CountryFlag } from "@/components/CountryFlag";
import { matchIsLocked } from "@/lib/scoring/lock";
import { isoToLocal } from "@/lib/utils";
import type { Pick1X2 } from "@/lib/supabase/types";

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, stage, group_letter, status, home_score, away_score, winner, home:home_team_id(id, name, code, crest_url), away:away_team_id(id, name, code, crest_url)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!match) notFound();

  const home = (Array.isArray(match.home) ? match.home[0] : match.home) as
    | { id: string; name: string; code: string; crest_url: string | null }
    | null;
  const away = (Array.isArray(match.away) ? match.away[0] : match.away) as
    | { id: string; name: string; code: string; crest_url: string | null }
    | null;

  const locked = matchIsLocked(match.kickoff_at);

  const { data: myPick } = await supabase
    .from("match_predictions")
    .select("pick")
    .eq("match_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: friendsPicks } = locked
    ? await supabase
        .from("match_predictions")
        .select("pick, profile:user_id(username, display_name)")
        .eq("match_id", id)
    : { data: null };

  const tally =
    locked && friendsPicks
      ? friendsPicks.reduce<Record<Pick1X2, number>>(
          (acc, r) => {
            const pick = r.pick as Pick1X2;
            acc[pick] = (acc[pick] ?? 0) + 1;
            return acc;
          },
          { HOME: 0, DRAW: 0, AWAY: 0 },
        )
      : null;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8 flex flex-col gap-6">
      <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
        ← Back
      </Link>
      <section className="card flex flex-col gap-6">
        <header className="flex items-center justify-between text-sm text-[var(--muted)]">
          <span>
            {match.group_letter ? `Group ${match.group_letter}` : match.stage} · {isoToLocal(match.kickoff_at)}
          </span>
          <span className="badge">{match.status}</span>
        </header>
        <div className="flex items-center justify-between gap-4">
          <TeamSide team={home} align="left" />
          <div className="text-center">
            {match.status === "FINISHED" ? (
              <div className="text-3xl font-bold tabular-nums">
                {match.home_score} – {match.away_score}
              </div>
            ) : (
              <div className="text-2xl font-mono text-[var(--muted)]">vs</div>
            )}
          </div>
          <TeamSide team={away} align="right" />
        </div>
        <p className="text-center text-sm text-[var(--muted)]">
          Your pick:{" "}
          <span className="text-[var(--foreground)] font-medium">
            {myPick?.pick ?? "— not picked —"}
          </span>
        </p>
      </section>

      {locked && tally && friendsPicks && (
        <section className="card flex flex-col gap-4">
          <h2 className="font-semibold">League picks</h2>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <PickStat label={home?.name ?? "Home"} count={tally.HOME} total={friendsPicks.length} />
            <PickStat label="Draw" count={tally.DRAW} total={friendsPicks.length} />
            <PickStat label={away?.name ?? "Away"} count={tally.AWAY} total={friendsPicks.length} />
          </div>
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {friendsPicks.map((row, i) => {
              const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
              return (
                <li key={`${profile?.username}-${i}`} className="flex items-center justify-between py-2">
                  <Link
                    href={`/profile/${profile?.username}`}
                    className="hover:text-[var(--accent)]"
                  >
                    {profile?.display_name ?? profile?.username}
                  </Link>
                  <span className="font-mono text-xs">{row.pick}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

function TeamSide({
  team,
  align,
}: {
  team: { name: string; code: string; crest_url: string | null } | null;
  align: "left" | "right";
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-2 flex-1",
        align === "left" ? "items-start sm:items-center" : "items-end sm:items-center",
      ].join(" ")}
    >
      <CountryFlag crestUrl={team?.crest_url} code={team?.code} name={team?.name ?? "TBD"} size={64} />
      <span className="font-semibold text-center">{team?.name ?? "TBD"}</span>
    </div>
  );
}

function PickStat({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="rounded-lg bg-[var(--surface-2)] p-3">
      <p className="text-xs text-[var(--muted)] truncate">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{count}</p>
      <p className="text-xs text-[var(--muted)] tabular-nums">{pct}%</p>
    </div>
  );
}
