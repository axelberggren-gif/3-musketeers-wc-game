import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { loadProfileStats } from "@/lib/stats/profile";
import { loadPickPersonality } from "@/lib/stats/personality";
import {
  groupMatchesByLetter,
  loadGroupStagePicks,
  pickOutcome,
  tallyPickRecord,
} from "@/lib/stats/group-picks";
import { PickPersonality } from "@/components/stats/PickPersonality";
import { PickChip } from "@/components/picks/PickChip";
import { MatchScoreline } from "@/components/picks/MatchScoreline";
import { PickReactionStrip } from "@/components/social/PickReactionStrip";
import { loadPickReactions } from "@/lib/predictions/reactions";
import { aggregateKey } from "@/lib/predictions/reactions-shared";
import { POINTS } from "@/lib/scoring/rules";

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

  const isSelf = viewerData.user?.id === profile.id;

  const [stats, personality, groupPicks] = await Promise.all([
    loadProfileStats(profile.id, viewerData.user?.id),
    loadPickPersonality(profile.id, viewerData.user?.id),
    loadGroupStagePicks([profile.id]),
  ]);

  // RLS scopes what's visible: everything on your own profile, a league-mate's
  // picks once round 1 locks, nothing for strangers (section omitted below).
  const ownPicks = groupPicks.picksByUser[profile.id] ?? {};
  const record = tallyPickRecord(groupPicks.matches, ownPicks);
  const groups = groupMatchesByLetter(groupPicks.matches);

  // "Compare" appears on someone else's profile once their picks are visible
  // to the viewer (i.e. they're a league-mate and round 1 has locked).
  const wantsCompare = !isSelf && !!viewerData.user && record.made > 0;
  const [reactionMap, viewerProfileRes] = await Promise.all([
    loadPickReactions(
      Object.values(ownPicks).map((p) => ({ id: p.pickId, kind: "match" as const })),
      viewerData.user?.id ?? null,
    ),
    wantsCompare
      ? supabase
          .from("profiles")
          .select("username")
          .eq("id", viewerData.user!.id)
          .maybeSingle()
      : Promise.resolve(null),
  ]);
  const viewerUsername = viewerProfileRes?.data?.username ?? null;
  const compareHref = viewerUsername
    ? `/compare?a=${encodeURIComponent(viewerUsername)}&b=${encodeURIComponent(profile.username)}`
    : null;

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
        {compareHref && (
          <Link
            href={compareHref}
            className="btn btn-primary btn-sm ml-auto self-start whitespace-nowrap"
          >
            ⚔️ Compare
          </Link>
        )}
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

      {(record.made > 0 || isSelf) && groupPicks.matches.length > 0 && (
        <section className="card flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-display uppercase tracking-wide text-base">
              Group-stage picks
            </h2>
            {record.decided > 0 && (
              <span className="badge badge-gold !text-[10px]">
                ✓ {record.correct}/{record.decided} correct
              </span>
            )}
          </div>
          {record.made === 0 ? (
            <p className="text-sm text-ink-soft">
              No picks yet —{" "}
              <Link href="/predict" className="underline hover:text-coral">
                make your group-stage calls
              </Link>
              .
            </p>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {groups.map(({ letter, matches }) => (
                <div
                  key={letter}
                  className="rounded-xl border-2 border-ink bg-paper-2 p-3 flex flex-col gap-2"
                  style={{ boxShadow: "3px 3px 0 var(--ink)" }}
                >
                  <h3 className="font-display uppercase text-sm tracking-wide">
                    Group {letter}
                  </h3>
                  <ul className="flex flex-col divide-y divide-dashed divide-ink-soft/40">
                    {matches.map((m) => {
                      const p = ownPicks[m.id] ?? null;
                      const outcome = p ? pickOutcome(p.pick, m) : "pending";
                      const agg = p
                        ? reactionMap.get(aggregateKey("match", p.pickId))
                        : undefined;
                      return (
                        <li
                          key={m.id}
                          className="flex flex-col gap-1.5 py-2 first:pt-0 last:pb-0"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <MatchScoreline match={m} />
                            <span className="flex items-center gap-1.5">
                              {p && outcome === "correct" && (
                                <span className="font-mono-sticker text-[10px] font-bold text-pitch">
                                  +{POINTS.match1x2}
                                </span>
                              )}
                              <PickChip
                                pick={p?.pick ?? null}
                                homeCode={m.home?.code}
                                awayCode={m.away?.code}
                                outcome={outcome}
                              />
                            </span>
                          </div>
                          {p && agg && (
                            <PickReactionStrip
                              pickId={p.pickId}
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
                </div>
              ))}
            </div>
          )}
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
