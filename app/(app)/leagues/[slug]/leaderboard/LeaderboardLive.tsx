"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { LeagueStandingsRow } from "@/lib/supabase/types";
import { VoteBadges } from "@/components/league-bets/VoteBadges";
import type { VoteTally } from "@/lib/league-bets/shared";

interface Props {
  leagueId: string;
  initialRows: LeagueStandingsRow[];
  currentUserId: string | null;
  // Per-member 👑 / 💩 vote counts (empty until round 1 locks). Static — votes
  // lock at first kickoff, so no realtime needed here.
  tallies: Record<string, VoteTally>;
}

export function LeaderboardLive({ leagueId, initialRows, currentUserId, tallies }: Props) {
  const [rows, setRows] = useState(initialRows);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`league:${leagueId}:awards`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "point_awards" },
        async () => {
          const { data } = await supabase
            .from("league_standings")
            .select("*")
            .eq("league_id", leagueId)
            .order("total_points", { ascending: false });
          if (data) setRows(data as LeagueStandingsRow[]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

  if (rows.length === 0) {
    return (
      <div className="card text-sm text-ink-soft">
        No points awarded yet. Predictions go live with the first match.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row, idx) => {
        const rank = idx + 1;
        const top = rank <= 3;
        const isMe = row.user_id === currentUserId;
        const rankBg =
          rank === 1
            ? "bg-gold"
            : rank === 2
              ? "bg-paper"
              : rank === 3
                ? "bg-coral text-white"
                : "bg-white";
        return (
          <Link
            key={row.user_id}
            href={`/profile/${row.username}`}
            className={[
              "rounded-xl border-2 border-ink px-3 sm:px-4 py-2.5 sm:py-3",
              "grid grid-cols-[44px_1fr_auto] sm:grid-cols-[56px_1fr_72px_72px_88px] items-center gap-3",
              "transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5",
              isMe ? "bg-gold" : "bg-white",
            ].join(" ")}
            style={{
              boxShadow: isMe ? "5px 5px 0 var(--coral)" : "3px 3px 0 var(--ink)",
            }}
          >
            <span
              className={[
                "inline-flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-md border-2 border-ink font-display text-base sm:text-xl",
                rankBg,
              ].join(" ")}
              style={{ boxShadow: top ? "2px 2px 0 var(--ink)" : undefined }}
            >
              {rank}
            </span>
            <div className="min-w-0">
              <div className="font-display uppercase text-sm sm:text-base tracking-wide truncate">
                {row.display_name ?? row.username}
                {isMe && (
                  <span className="ml-2 font-mono-sticker text-[10px] text-pitch normal-case tracking-widest">
                    ← YOU
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono-sticker text-[11px] text-ink-soft truncate">
                  @{row.username}
                </span>
                <VoteBadges
                  crown={tallies[row.user_id]?.crown ?? 0}
                  poop={tallies[row.user_id]?.poop ?? 0}
                />
              </div>
            </div>
            <div className="hidden sm:flex flex-col items-center">
              <span className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft font-medium">
                Bracket
              </span>
              <span className="font-display text-sm tabular-nums">{row.bracket_points}</span>
            </div>
            <div className="hidden sm:flex flex-col items-center">
              <span className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft font-medium">
                Props
              </span>
              <span className="font-display text-sm tabular-nums">
                {row.tournament_points + row.prop_points}
              </span>
            </div>
            <div className="text-right">
              <span className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft font-medium">
                Points
              </span>
              <div className="font-display text-2xl sm:text-3xl tabular-nums leading-none">
                {row.total_points}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
