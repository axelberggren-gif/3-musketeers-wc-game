"use client";

import { useMemo, useState } from "react";
import { MatchPickCard, type MatchPickRow } from "./MatchPickCard";
import type { Pick1X2 } from "@/lib/supabase/types";

export type GroupStageMatch = {
  id: string;
  kickoff_at: string;
  group_letter: string | null;
  home: MatchPickRow["home"];
  away: MatchPickRow["away"];
};

type GroupCoverage = { picked: number; total: number };

type Props = {
  matches: GroupStageMatch[];
  groupLetters: string[];
  groupCoverage: Record<string, GroupCoverage>;
  picksByMatch: Record<string, Pick1X2>;
  locked: boolean;
};

/**
 * Group-stage match list with a sticker-styled group filter on top.
 *
 * Filter behaviour (per UX brief):
 * - No active group → show every match in every group.
 * - Click a group letter → show only that group; matches still ordered by kickoff.
 * - Click the active group again → un-filter (back to all matches).
 * - Click a different group while one is active → switch to the new group.
 * - "All groups" pill (gold when no filter is active) also clears the filter.
 *
 * State is local (no URL param) so filter clicks feel instant and no server
 * round-trip is needed. Matches are already ordered by kickoff_at from the
 * server query — we keep that order when filtering.
 */
export function GroupStageList({
  matches,
  groupLetters,
  groupCoverage,
  picksByMatch,
  locked,
}: Props) {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const visibleMatches = useMemo(
    () =>
      activeGroup
        ? matches.filter((m) => m.group_letter === activeGroup)
        : matches,
    [activeGroup, matches],
  );

  // Re-group filtered matches by date for the existing date-banner layout.
  const groupedByDate = useMemo(() => {
    return visibleMatches.reduce<Record<string, GroupStageMatch[]>>((acc, m) => {
      const date = new Date(m.kickoff_at).toDateString();
      (acc[date] ??= []).push(m);
      return acc;
    }, {});
  }, [visibleMatches]);

  const toggleGroup = (letter: string) => {
    setActiveGroup((current) => (current === letter ? null : letter));
  };

  const allActive = activeGroup === null;

  return (
    <>
      {groupLetters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveGroup(null)}
            aria-pressed={allActive}
            className={[
              "inline-flex items-center rounded-full border-2 border-ink font-display uppercase text-[11px] tracking-wider px-3 py-1",
              allActive ? "bg-gold text-ink" : "bg-white text-ink",
            ].join(" ")}
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            All groups
          </button>
          {groupLetters.map((g) => {
            const stats = groupCoverage[g] ?? { picked: 0, total: 0 };
            const complete = stats.picked === stats.total && stats.total > 0;
            const active = activeGroup === g;
            return (
              <button
                type="button"
                key={g}
                onClick={() => toggleGroup(g)}
                aria-pressed={active}
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border-2 border-ink font-display uppercase text-[11px] tracking-wider px-3 py-1",
                  active
                    ? "bg-gold text-ink"
                    : complete
                      ? "bg-pitch text-white"
                      : "bg-white text-ink",
                ].join(" ")}
                style={{ boxShadow: "3px 3px 0 var(--ink)" }}
              >
                Group {g}
                {complete ? (
                  <span aria-label="complete">✓</span>
                ) : (
                  <span
                    className={[
                      "font-mono-sticker text-[10px] normal-case",
                      active ? "text-ink" : "text-ink-soft",
                    ].join(" ")}
                  >
                    {stats.picked}/{stats.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {Object.entries(groupedByDate).map(([date, group]) => (
        <div key={date} className="flex flex-col gap-3">
          <h3 className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft font-medium">
            {date}
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            {group.map((m) => (
              <MatchPickCard
                key={m.id}
                match={{
                  id: m.id,
                  kickoff_at: m.kickoff_at,
                  group_letter: m.group_letter,
                  home: m.home,
                  away: m.away,
                }}
                initialPick={picksByMatch[m.id] ?? null}
                locked={locked}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
