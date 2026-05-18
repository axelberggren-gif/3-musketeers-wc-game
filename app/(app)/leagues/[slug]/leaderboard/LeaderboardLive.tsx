"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { LeagueStandingsRow } from "@/lib/supabase/types";

interface Props {
  leagueId: string;
  initialRows: LeagueStandingsRow[];
}

export function LeaderboardLive({ leagueId, initialRows }: Props) {
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
      <div className="card text-sm text-[var(--muted)]">
        No points awarded yet. Predictions go live with the first match.
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-2">#</th>
            <th className="text-left px-4 py-2">Player</th>
            <th className="text-right px-4 py-2">1X2</th>
            <th className="text-right px-4 py-2">Bracket</th>
            <th className="text-right px-4 py-2">Tournament</th>
            <th className="text-right px-4 py-2">Props</th>
            <th className="text-right px-4 py-2">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row, idx) => (
            <tr key={row.user_id}>
              <td className="px-4 py-2 text-[var(--muted)] tabular-nums">{idx + 1}</td>
              <td className="px-4 py-2">
                <Link href={`/profile/${row.username}`} className="hover:text-[var(--accent)]">
                  {row.display_name ?? row.username}
                </Link>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{row.match_points}</td>
              <td className="px-4 py-2 text-right tabular-nums">{row.bracket_points}</td>
              <td className="px-4 py-2 text-right tabular-nums">{row.tournament_points}</td>
              <td className="px-4 py-2 text-right tabular-nums">{row.prop_points}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">
                {row.total_points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
