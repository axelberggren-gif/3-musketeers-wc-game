"use client";

import { useState } from "react";
import type { LeaguePulse, TournamentPulse, PulseTile, PulseHighlight } from "@/lib/stats/pulse";

interface Props {
  league: LeaguePulse;
  tournament: TournamentPulse;
}

type Mode = "league" | "tournament";

export function PulseTabs({ league, tournament }: Props) {
  const [mode, setMode] = useState<Mode>("league");
  const active = mode === "league" ? league : tournament;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="badge badge-coral self-start -rotate-2"
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            Pulse
          </span>
          <h2 className="font-display uppercase text-2xl sm:text-3xl leading-none tracking-tight">
            {mode === "league" ? "League heat" : "Tournament heat"}
          </h2>
        </div>
        <div
          role="tablist"
          aria-label="Pulse mode"
          className="inline-flex rounded-full border-2 border-ink bg-paper-2 p-1"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          <TabButton
            label="League"
            active={mode === "league"}
            onClick={() => setMode("league")}
          />
          <TabButton
            label="Tournament"
            active={mode === "tournament"}
            onClick={() => setMode("tournament")}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {active.tiles.map((t) => (
          <TileCard key={t.key} tile={t} />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {active.highlights.map((h) => (
          <HighlightRow key={h.key} highlight={h} />
        ))}
      </div>
    </section>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "px-3 py-1.5 rounded-full font-display uppercase text-xs tracking-widest transition-colors",
        active ? "bg-ink text-gold" : "text-ink hover:bg-paper",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function TileCard({ tile }: { tile: PulseTile }) {
  return (
    <div
      className="rounded-xl border-2 border-ink bg-white px-3 py-3 sm:px-4 sm:py-4 flex flex-col gap-1"
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      <span className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft">
        {tile.label}
      </span>
      <span className="font-display text-3xl sm:text-4xl tabular-nums leading-none">
        {tile.value}
      </span>
      {tile.sublabel && (
        <span className="font-mono-sticker text-[10px] text-ink-soft truncate">
          {tile.sublabel}
        </span>
      )}
    </div>
  );
}

function HighlightRow({ highlight }: { highlight: PulseHighlight }) {
  return (
    <div
      className="rounded-xl border-2 border-ink bg-paper-2 px-3 py-2.5 sm:px-4 sm:py-3 grid grid-cols-[auto_1fr] gap-3 items-center"
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      <span className="font-mono-sticker text-[10px] uppercase tracking-widest text-ink-soft whitespace-nowrap">
        {highlight.label}
      </span>
      <div className="min-w-0">
        <div className="font-display uppercase text-sm sm:text-base truncate">
          {highlight.primary}
        </div>
        <div className="font-mono-sticker text-[11px] text-ink-soft truncate">
          {highlight.secondary}
        </div>
      </div>
    </div>
  );
}
