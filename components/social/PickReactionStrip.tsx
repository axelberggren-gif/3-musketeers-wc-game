"use client";

import { useState, useTransition } from "react";
import { togglePickReaction } from "@/lib/predictions/actions";
import {
  PICK_REACTION_EMOJI,
  type PickKind,
  type PickReactionEmoji,
} from "@/lib/predictions/reactions-shared";

interface Props {
  pickId: string;
  pickKind: PickKind;
  initialCounts: Record<PickReactionEmoji, number>;
  initialMine: PickReactionEmoji[];
  revalidatePath?: string;
}

export function PickReactionStrip({
  pickId,
  pickKind,
  initialCounts,
  initialMine,
  revalidatePath,
}: Props) {
  const [counts, setCounts] = useState<Record<PickReactionEmoji, number>>(initialCounts);
  const [mine, setMine] = useState<Set<PickReactionEmoji>>(new Set(initialMine));
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function react(emoji: PickReactionEmoji) {
    if (pending) return;
    const prevCounts = counts;
    const prevMine = mine;
    const wasMine = mine.has(emoji);
    const nextCounts = {
      ...counts,
      [emoji]: Math.max(0, (counts[emoji] ?? 0) + (wasMine ? -1 : 1)),
    };
    const nextMine = new Set(mine);
    if (wasMine) nextMine.delete(emoji);
    else nextMine.add(emoji);
    setCounts(nextCounts);
    setMine(nextMine);
    setOpen(false);
    setError(null);
    startTransition(async () => {
      const result = await togglePickReaction(pickId, pickKind, emoji, revalidatePath);
      if (!result.ok) {
        setCounts(prevCounts);
        setMine(prevMine);
        setError(result.error);
      }
    });
  }

  const active = PICK_REACTION_EMOJI.filter((e) => (counts[e] ?? 0) > 0);
  const hasAny = active.length > 0;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {active.map((e) => {
        const isMine = mine.has(e);
        return (
          <button
            key={e}
            type="button"
            onClick={() => react(e)}
            disabled={pending}
            aria-pressed={isMine}
            aria-label={`React with ${e}`}
            className={[
              "inline-flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5",
              "font-mono-sticker text-[10px] font-bold tabular-nums",
              isMine ? "bg-gold text-ink" : "bg-paper-2 text-ink",
              pending ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
            style={isMine ? { boxShadow: "1px 1px 0 var(--ink)" } : undefined}
          >
            <span className="text-[11px] leading-none">{e}</span>
            <span>{counts[e]}</span>
          </button>
        );
      })}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={pending}
          aria-expanded={open}
          aria-label="Add a reaction"
          className={[
            "rounded-full border-2 border-dashed border-ink px-2 py-0.5",
            "font-mono-sticker text-[10px] font-bold tracking-wide",
            open ? "bg-ink text-gold" : "text-ink-soft",
            pending ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          + react
        </button>
        {open && (
          <div
            className="absolute left-0 z-10 flex gap-1 rounded-full border-2 border-ink bg-white p-1"
            style={{ bottom: "calc(100% + 4px)", boxShadow: "3px 3px 0 var(--ink)" }}
          >
            {PICK_REACTION_EMOJI.map((e) => {
              const isMine = mine.has(e);
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => react(e)}
                  aria-label={`React with ${e}`}
                  className={[
                    "w-7 h-7 rounded-full text-[15px] leading-none flex items-center justify-center",
                    isMine ? "bg-gold border-2 border-ink" : "border-2 border-transparent",
                  ].join(" ")}
                >
                  {e}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!hasAny && (
        <span className="font-mono-sticker text-[9px] font-semibold text-ink-soft ml-auto">
          be first
        </span>
      )}
      {error && <span className="text-[10px] text-red font-medium">{error}</span>}
    </div>
  );
}
