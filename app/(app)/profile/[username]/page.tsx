import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { loadProfileStats } from "@/lib/stats/profile";
import { loadPickPersonality } from "@/lib/stats/personality";
import { PickPersonality } from "@/components/stats/PickPersonality";
import { PickReactionStrip } from "@/components/social/PickReactionStrip";
import { loadPickReactions } from "@/lib/predictions/reactions";
import { aggregateKey } from "@/lib/predictions/reactions-shared";
import type { Pick1X2 } from "@/lib/supabase/types";

type TeamLite = { code: string; name: string };
type MatchLite = {
  id: string;
  kickoff_at: string;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  home: TeamLite | null;
  away: TeamLite | null;
};

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await supabaseServer();
  const [{ data: profile }, { data: viewerData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, created_at")
      .eq("username", username)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!profile) notFound();

  const [stats, personality] = await Promise.all([
    loadProfileStats(profile.id, viewerData.user?.id),
    loadPickPersonality(profile.id, viewerData.user?.id),
  ]);

  const { data: recentPicksRaw } = await supabase
    .from("match_predictions")
    .select(
      "id, pick, submitted_at, match:matches!match_id(id, kickoff_at, status, home_score, away_score, home:teams!home_team_id(code, name), away:teams!away_team_id(code, name))",
    )
    .eq("user_id", profile.id)
    .order("submitted_at", { ascending: false })
    .limit(10);

  const recentPicks = (recentPicksRaw ?? []).filter((r) => r.match);

  const reactionMap = await loadPickReactions(
    recentPicks.map((r) => ({ id: r.id as string, kind: "match" as const })),
    viewerData.user?.id ?? null,
  );

  const initial = (profile.display_name ?? profile.username).slice(0, 1).toUpperCase();

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="card flex items-center gap-4 sm:gap-5">
        <div
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-gold border-2 border-ink flex items-center justify-center font-display text-4xl sm:text-5xl"
          style={{ boxShadow: "4px 4px 0 var(--ink)" }}
          aria-hidden
        >
          {initial}
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="badge badge-pitch self-start !text-[10px]">Player</span>
          <h1 className="font-display uppercase text-3xl sm:text-4xl leading-none tracking-tight truncate">
            {profile.display_name ?? profile.username}
          </h1>
          <p className="font-mono-sticker text-xs text-ink-soft">@{profile.username}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Points" value={stats.totalPoints} accent="gold" />
        {stats.accuracy !== null ? (
          <Stat label="Acc. 1X2" value={`${stats.accuracy}%`} accent="pitch" />
        ) : (
          <Stat label="Acc. 1X2" value="—" accent="pitch" />
        )}
        <Stat label="Picks" value={stats.picksMade ?? 0} accent="coral" />
        <Stat label="Correct" value={stats.picksScored} accent="paper" />
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="1X2" value={stats.matchPoints} subtle />
        <Stat label="Bracket" value={stats.bracketPoints} subtle />
        <Stat label="Tournament" value={stats.tournamentPoints} subtle />
        <Stat label="Props" value={stats.propPoints} subtle />
      </section>

      {recentPicks.length > 0 && (
        <section className="card flex flex-col gap-3">
          <h2 className="font-display uppercase tracking-wide text-base">Recent picks</h2>
          <ul className="flex flex-col divide-y divide-dashed divide-ink-soft/40">
            {recentPicks.map((row) => {
              const match = row.match as MatchLite | null;
              const home = match?.home ?? null;
              const away = match?.away ?? null;
              const pick = row.pick as Pick1X2;
              const finished = match?.status === "FINISHED";
              const score =
                finished && match
                  ? `${match.home_score ?? 0}–${match.away_score ?? 0}`
                  : null;
              const agg = reactionMap.get(aggregateKey("match", row.id as string));
              return (
                <li key={row.id as string} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      href={`/match/${match?.id}`}
                      className="font-display uppercase text-sm tracking-wide hover:text-coral truncate"
                    >
                      {home?.code ?? "?"} <span className="text-ink-soft">vs</span> {away?.code ?? "?"}
                      {score && (
                        <span className="font-mono-sticker text-xs text-ink-soft ml-2">{score}</span>
                      )}
                    </Link>
                    <span className="badge badge-ink !text-[10px]">{pick}</span>
                  </div>
                  {agg && (
                    <PickReactionStrip
                      pickId={row.id as string}
                      pickKind="match"
                      initialCounts={agg.counts}
                      initialMine={Array.from(agg.mine)}
                      revalidatePath={`/profile/${profile.username}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {personality && <PickPersonality data={personality} />}
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
  subtle,
}: {
  label: string;
  value: string | number;
  accent?: "gold" | "pitch" | "coral" | "paper";
  subtle?: boolean;
}) {
  const bg =
    subtle || !accent
      ? "bg-white"
      : accent === "gold"
        ? "bg-gold"
        : accent === "pitch"
          ? "bg-pitch text-white"
          : accent === "coral"
            ? "bg-coral text-white"
            : "bg-paper-2";
  return (
    <div
      className={`rounded-xl border-2 border-ink p-3 sm:p-4 flex flex-col gap-1 ${bg}`}
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      <p className="font-mono-sticker text-[10px] uppercase tracking-widest font-medium opacity-80">
        {label}
      </p>
      <p className="font-display text-2xl sm:text-3xl tabular-nums leading-none">{value}</p>
    </div>
  );
}
