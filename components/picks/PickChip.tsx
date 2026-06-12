import type { Pick1X2 } from "@/lib/supabase/types";
import type { PickOutcome } from "@/lib/stats/group-picks";

interface Props {
  /** null = no visible pick for this match. */
  pick: Pick1X2 | null;
  homeCode: string | null | undefined;
  awayCode: string | null | undefined;
  /** Outcome of the pick; ignored when `pick` is null. */
  outcome: PickOutcome;
}

/**
 * One user's 1X2 call for one match as a sticker chip: the picked team's code
 * (or "Draw"), coloured by outcome once the result is in — pitch-green ✓ for a
 * correct call, coral ✗ for a miss, neutral paper while pending. Hook-free so
 * it renders inside server pages and client components alike.
 */
export function PickChip({ pick, homeCode, awayCode, outcome }: Props) {
  if (!pick) {
    return (
      <span className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft">
        No pick
      </span>
    );
  }
  const label =
    pick === "HOME" ? (homeCode ?? "Home") : pick === "AWAY" ? (awayCode ?? "Away") : "Draw";
  const tone =
    outcome === "correct"
      ? "bg-pitch text-white"
      : outcome === "wrong"
        ? "bg-coral text-white"
        : "bg-paper-2";
  const mark = outcome === "correct" ? "✓" : outcome === "wrong" ? "✗" : null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border-2 border-ink px-2 py-0.5 font-display uppercase text-xs tracking-wide whitespace-nowrap ${tone}`}
      style={{ boxShadow: "2px 2px 0 var(--ink)" }}
    >
      {mark && <span aria-hidden>{mark}</span>}
      {label}
      <span className="sr-only">
        {outcome === "correct" ? " — correct" : outcome === "wrong" ? " — wrong" : ""}
      </span>
    </span>
  );
}
