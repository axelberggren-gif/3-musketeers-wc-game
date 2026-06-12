"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CountryFlag } from "@/components/CountryFlag";
import { LocalKickoff } from "@/components/LocalKickoff";
import { PickChip } from "@/components/picks/PickChip";
import { MatchScoreline } from "@/components/picks/MatchScoreline";
import {
  pickOutcome,
  type GroupPickMatch,
  type VisiblePick,
} from "@/lib/stats/picks-shared";
import { tallyMatchPicks, type MatchPickTally } from "@/lib/stats/league-pulse";

export type TodayMember = {
  id: string;
  username: string;
  label: string;
};

type Props = {
  /** Group-stage matches in kickoff order (loadGroupStagePicks output). */
  matches: GroupPickMatch[];
  /** userId → matchId → visible pick, already RLS-scoped to the viewer. */
  picksByUser: Record<string, Record<string, VisiblePick>>;
  /** League members, viewer first. */
  members: TodayMember[];
  selfId: string;
  /** round-1 lock — league-mates' picks exist (RLS) and render only after this. */
  revealed: boolean;
  /** Server render time, the pre-mount "today" anchor. */
  serverNowIso: string;
};

function localYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * The /today hero: today's matches with every league member's call laid out per
 * match, framed by yesterday's results and the next slate. Day bucketing is
 * timezone-sensitive, so SSR + first client render bucket by the kickoff ISO's
 * UTC date (stable across runtimes); a rAF-driven effect re-buckets in the
 * viewer's local timezone after mount — the same hydration-safety pattern as
 * GroupStageList / LocalKickoff (Sentry JAVASCRIPT-NEXTJS-5).
 */
export function TodayBoard({
  matches,
  picksByUser,
  members,
  selfId,
  revealed,
  serverNowIso,
}: Props) {
  const [clientNow, setClientNow] = useState<Date | null>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setClientNow(new Date()));
    return () => cancelAnimationFrame(raf);
  }, []);

  const { todayKey, todayMatches, prevKey, prevMatches, nextKey, nextMatches } =
    useMemo(() => {
      const keyFor = (iso: string) =>
        clientNow ? localYMD(new Date(iso)) : iso.slice(0, 10);
      const anchor = clientNow ? localYMD(clientNow) : serverNowIso.slice(0, 10);

      const buckets = new Map<string, GroupPickMatch[]>();
      for (const m of matches) {
        const k = keyFor(m.kickoff_at);
        const bucket = buckets.get(k) ?? [];
        bucket.push(m);
        buckets.set(k, bucket);
      }
      const keys = [...buckets.keys()].sort();
      const prev = keys.filter((k) => k < anchor).at(-1) ?? null;
      const next = keys.find((k) => k > anchor) ?? null;
      return {
        todayKey: anchor,
        todayMatches: buckets.get(anchor) ?? [],
        prevKey: prev,
        prevMatches: prev ? buckets.get(prev)! : [],
        nextKey: next,
        nextMatches: next ? buckets.get(next)! : [],
      };
    }, [matches, clientNow, serverNowIso]);

  const dayLabel = (key: string) => {
    if (!clientNow) return key;
    const offset = (days: number) => {
      const d = new Date(clientNow);
      d.setDate(d.getDate() + days);
      return localYMD(d);
    };
    if (key === offset(1)) return "Tomorrow";
    if (key === offset(-1)) return "Yesterday";
    return new Date(`${key}T12:00:00`).toDateString();
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-display uppercase tracking-wide text-lg">
            Today&rsquo;s matches
          </h2>
          <span
            className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft"
            suppressHydrationWarning
          >
            {clientNow ? new Date(`${todayKey}T12:00:00`).toDateString() : todayKey}
          </span>
        </div>
        {todayMatches.length === 0 ? (
          <div className="card text-sm text-ink-soft">
            <p>No matches today — a rare rest day. 😴 The next slate is below.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {todayMatches.map((m) => (
              <TodayMatchCard
                key={m.id}
                match={m}
                picksByUser={picksByUser}
                members={members}
                selfId={selfId}
                revealed={revealed}
              />
            ))}
          </div>
        )}
      </section>

      {nextKey && (
        <CompactDaySection
          title={dayLabel(nextKey)}
          matches={nextMatches}
          picksByUser={picksByUser}
          selfId={selfId}
          revealed={revealed}
          showKickoff
        />
      )}

      {prevKey && (
        <CompactDaySection
          title={dayLabel(prevKey)}
          matches={prevMatches}
          picksByUser={picksByUser}
          selfId={selfId}
          revealed={revealed}
        />
      )}
    </div>
  );
}

// ─── One hero card: the match + every member's call ─────────────────────────
function TodayMatchCard({
  match,
  picksByUser,
  members,
  selfId,
  revealed,
}: {
  match: GroupPickMatch;
  picksByUser: Record<string, Record<string, VisiblePick>>;
  members: TodayMember[];
  selfId: string;
  revealed: boolean;
}) {
  const live = match.status === "LIVE";
  const finished = match.status === "FINISHED";
  const tally = revealed ? tallyMatchPicks(match.id, picksByUser) : null;

  return (
    <article
      className="card flex flex-col gap-4"
      style={{ boxShadow: live ? "4px 4px 0 var(--coral)" : "4px 4px 0 var(--ink)" }}
    >
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <span className="badge">
          {match.group_letter ? `Group ${match.group_letter}` : "Group stage"}
        </span>
        <LocalKickoff
          iso={match.kickoff_at}
          className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft"
        />
        {live ? (
          <span className="badge badge-red">● LIVE</span>
        ) : finished ? (
          <span className="badge badge-pitch">Final</span>
        ) : (
          <span className="badge badge-gold">Upcoming</span>
        )}
      </header>

      <Link
        href={`/match/${match.id}`}
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 hover:opacity-90"
      >
        <TeamSide team={match.home} />
        <div className="text-center">
          {finished || live ? (
            <span
              className={`font-display text-3xl sm:text-4xl tabular-nums leading-none ${
                live ? "text-coral" : ""
              }`}
            >
              {match.home_score ?? "–"}
              <span className="text-coral mx-1">–</span>
              {match.away_score ?? "–"}
            </span>
          ) : (
            <span className="font-mono-sticker text-xl text-ink-soft uppercase tracking-widest">
              vs
            </span>
          )}
        </div>
        <TeamSide team={match.away} align="right" />
      </Link>

      {tally && tally.total > 0 && (
        <PickSplitBar
          tally={tally}
          homeCode={match.home?.code}
          awayCode={match.away?.code}
        />
      )}

      {revealed ? (
        <ul className="grid sm:grid-cols-2 gap-2">
          {members.map((member) => {
            const p = picksByUser[member.id]?.[match.id] ?? null;
            const isSelf = member.id === selfId;
            return (
              <li
                key={member.id}
                className={`flex items-center justify-between gap-2 rounded-lg border-2 border-ink px-2.5 py-1.5 ${
                  isSelf ? "bg-gold" : "bg-paper-2"
                }`}
                style={{ boxShadow: "2px 2px 0 var(--ink)" }}
              >
                <Link
                  href={`/profile/${member.username}`}
                  className="font-display uppercase text-xs tracking-wide truncate hover:text-coral"
                >
                  {member.label}
                  {isSelf && <span className="text-ink-soft"> (you)</span>}
                </Link>
                <PickChip
                  pick={p?.pick ?? null}
                  homeCode={match.home?.code}
                  awayCode={match.away?.code}
                  outcome={p ? pickOutcome(p.pick, match) : "pending"}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">
          🤫 Everyone&rsquo;s picks reveal at the first kickoff.
        </p>
      )}
    </article>
  );
}

function TeamSide({
  team,
  align = "left",
}: {
  team: GroupPickMatch["home"];
  align?: "left" | "right";
}) {
  return (
    <span
      className={`flex items-center gap-2 min-w-0 ${
        align === "right" ? "flex-row-reverse" : ""
      }`}
    >
      <span
        className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl bg-paper-2 border-2 border-ink flex items-center justify-center"
        style={{ boxShadow: "2px 2px 0 var(--ink)" }}
      >
        <CountryFlag
          crestUrl={team?.crest_url}
          code={team?.code}
          name={team?.name ?? "TBD"}
          size={28}
        />
      </span>
      <span className="font-display uppercase text-sm sm:text-base tracking-wide truncate">
        {team?.code ?? "TBD"}
      </span>
    </span>
  );
}

// ─── "4 CAN · 3 Draw · 2 BIH" as a segmented bar ─────────────────────────────
function PickSplitBar({
  tally,
  homeCode,
  awayCode,
}: {
  tally: MatchPickTally;
  homeCode: string | null | undefined;
  awayCode: string | null | undefined;
}) {
  const pct = (n: number) => `${(n / tally.total) * 100}%`;
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full border-2 border-ink"
        role="img"
        aria-label={`League split: ${tally.home} ${homeCode ?? "home"}, ${tally.draw} draw, ${tally.away} ${awayCode ?? "away"}`}
      >
        <div className="bg-gold h-full" style={{ width: pct(tally.home) }} />
        <div className="bg-white h-full" style={{ width: pct(tally.draw) }} />
        <div className="bg-coral h-full" style={{ width: pct(tally.away) }} />
      </div>
      <p className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft">
        {tally.home} {homeCode ?? "home"} · {tally.draw} draw · {tally.away}{" "}
        {awayCode ?? "away"}
      </p>
    </div>
  );
}

// ─── Compact yesterday / next-slate rows ─────────────────────────────────────
function CompactDaySection({
  title,
  matches,
  picksByUser,
  selfId,
  revealed,
  showKickoff = false,
}: {
  title: string;
  matches: GroupPickMatch[];
  picksByUser: Record<string, Record<string, VisiblePick>>;
  selfId: string;
  revealed: boolean;
  showKickoff?: boolean;
}) {
  return (
    <section className="card flex flex-col gap-3">
      <h2
        className="font-display uppercase tracking-wide text-base"
        suppressHydrationWarning
      >
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {matches.map((m) => {
          const mine = picksByUser[selfId]?.[m.id] ?? null;
          const tally = revealed ? tallyMatchPicks(m.id, picksByUser) : null;
          return (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-lg border-2 border-ink bg-paper-2 px-3 py-2 flex-wrap"
              style={{ boxShadow: "2px 2px 0 var(--ink)" }}
            >
              <MatchScoreline match={m} />
              <span className="flex items-center gap-2 flex-wrap">
                {tally && tally.total > 0 && (
                  <span className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft">
                    {tally.home}·{tally.draw}·{tally.away}
                  </span>
                )}
                <PickChip
                  pick={mine?.pick ?? null}
                  homeCode={m.home?.code}
                  awayCode={m.away?.code}
                  outcome={mine ? pickOutcome(mine.pick, m) : "pending"}
                />
                {showKickoff && (
                  <LocalKickoff
                    iso={m.kickoff_at}
                    options={{ weekday: undefined, year: undefined }}
                    className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft"
                  />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
