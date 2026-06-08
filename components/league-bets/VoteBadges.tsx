import { BET_EMOJI } from "@/lib/league-bets/shared";

// Presentational 👑 N / 💩 N cluster shown next to a league member. No "use client"
// — it has no hooks, so it renders in both server pages and client components.
// Renders nothing when the member has no votes.
export function VoteBadges({ crown, poop }: { crown: number; poop: number }) {
  if (crown <= 0 && poop <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {crown > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-md border-2 border-ink bg-gold px-1.5 py-0.5 font-display text-[11px] leading-none"
          style={{ boxShadow: "1px 1px 0 var(--ink)" }}
          title={`${crown} ${crown === 1 ? "vote" : "votes"} to top the group stage`}
        >
          <span aria-hidden>{BET_EMOJI.most_points}</span>
          <span className="tabular-nums">{crown}</span>
        </span>
      )}
      {poop > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-md border-2 border-ink bg-paper-2 px-1.5 py-0.5 font-display text-[11px] leading-none"
          style={{ boxShadow: "1px 1px 0 var(--ink)" }}
          title={`${poop} ${poop === 1 ? "vote" : "votes"} to finish bottom`}
        >
          <span aria-hidden>{BET_EMOJI.least_points}</span>
          <span className="tabular-nums">{poop}</span>
        </span>
      )}
    </span>
  );
}
