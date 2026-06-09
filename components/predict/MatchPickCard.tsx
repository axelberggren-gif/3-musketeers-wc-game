"use client";

import { useEffect, useState, useTransition } from "react";
import { setMatchPick } from "@/lib/predictions/actions";
import type { Pick1X2 } from "@/lib/supabase/types";
import { CountryFlag } from "@/components/CountryFlag";
import { isoToLocal } from "@/lib/utils";

interface Team {
  id: string;
  name: string;
  short_name: string | null;
  code: string;
  crest_url: string | null;
}

export interface MatchPickRow {
  id: string;
  kickoff_at: string;
  group_letter: string | null;
  home: Team | null;
  away: Team | null;
}

interface Props {
  match: MatchPickRow;
  initialPick: Pick1X2 | null;
  locked: boolean;
}

export function MatchPickCard({ match, initialPick, locked }: Props) {
  const [pick, setPick] = useState<Pick1X2 | null>(initialPick);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Defer locale-formatted kickoff text until after mount. `isoToLocal` uses
  // `Intl.DateTimeFormat` which renders in the runtime's timezone; SSR (UTC)
  // and the user's browser disagree, producing a React hydration mismatch
  // (Sentry JAVASCRIPT-NEXTJS-5). SSR + first client render both emit the
  // ISO placeholder, then the effect swaps in the localized string.
  const [kickoffLabel, setKickoffLabel] = useState<string | null>(null);
  useEffect(() => {
    // Defer the locale-formatted swap to a separate frame so the initial
    // hydration render still emits the placeholder (matching the SSR HTML)
    // before React commits the localized value — same pattern as
    // CountdownBanner.
    const raf = requestAnimationFrame(() =>
      setKickoffLabel(isoToLocal(match.kickoff_at)),
    );
    return () => cancelAnimationFrame(raf);
  }, [match.kickoff_at]);

  function choose(value: Pick1X2) {
    if (locked || pending) return;
    const previous = pick;
    const next = pick === value ? null : value;
    setPick(next);
    setError(null);
    startTransition(async () => {
      try {
        const result = await setMatchPick(match.id, next);
        if (!result.ok) {
          setPick(previous);
          setError(result.error);
        }
      } catch {
        // Network blip mid-server-action (Chrome surfaces this as
        // "TypeError: Failed to fetch" or the Next.js framework error
        // "An unexpected response was received from the server."). Roll
        // back the optimistic pick and surface a retry-friendly message
        // instead of letting the uncaught rejection bubble to Sentry's
        // window.unhandledrejection auto-capture. Mirrors LoginForm /
        // WelcomeForm (Sentry JAVASCRIPT-NEXTJS-A / -B).
        setPick(previous);
        setError("Couldn’t reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="card !p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="badge !text-[10px]">
          {match.group_letter ? `Group ${match.group_letter}` : "Group"}
        </span>
        <span
          className="font-mono-sticker text-[11px] text-ink-soft uppercase tracking-wider"
          suppressHydrationWarning
        >
          {kickoffLabel ?? "—"}
        </span>
        {locked ? (
          <span className="badge badge-ink">Locked</span>
        ) : pick ? (
          <span className="badge badge-pitch">✓ Picked</span>
        ) : (
          <span className="badge badge-coral">Pick!</span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_64px_1fr] sm:grid-cols-[1fr_80px_1fr] gap-2 items-stretch">
        <PickTile
          selected={pick === "HOME"}
          disabled={locked}
          label={match.home?.short_name ?? match.home?.code ?? match.home?.name ?? "Home"}
          flag={
            match.home ? (
              <CountryFlag
                crestUrl={match.home.crest_url}
                code={match.home.code}
                name={match.home.name}
                size={48}
              />
            ) : null
          }
          onClick={() => choose("HOME")}
        />
        <DrawTile
          selected={pick === "DRAW"}
          disabled={locked}
          onClick={() => choose("DRAW")}
        />
        <PickTile
          selected={pick === "AWAY"}
          disabled={locked}
          label={match.away?.short_name ?? match.away?.code ?? match.away?.name ?? "Away"}
          flag={
            match.away ? (
              <CountryFlag
                crestUrl={match.away.crest_url}
                code={match.away.code}
                name={match.away.name}
                size={48}
              />
            ) : null
          }
          onClick={() => choose("AWAY")}
        />
      </div>
      {error && <p className="text-xs text-red font-medium">{error}</p>}
    </div>
  );
}

function PickTile({
  label,
  flag,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  flag: React.ReactNode;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-xl border-2 border-ink flex flex-col items-center justify-center gap-1.5 py-3 px-1.5 text-center",
        "min-h-[96px] font-display uppercase tracking-wider text-xs",
        "transition-transform",
        selected ? "bg-gold text-ink" : "bg-paper-2 text-ink",
        disabled
          ? "opacity-60 cursor-not-allowed"
          : "cursor-pointer hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0 active:translate-y-0",
      ].join(" ")}
      style={{
        boxShadow: selected ? "3px 3px 0 var(--ink)" : "3px 3px 0 var(--ink)",
      }}
    >
      <div className="flex items-center justify-center">{flag}</div>
      <span className="leading-tight">{label}</span>
    </button>
  );
}

function DrawTile({
  selected,
  disabled,
  onClick,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-full border-2 border-ink flex items-center justify-center text-center font-display uppercase tracking-wider text-[11px]",
        "self-center mx-auto w-14 h-14 sm:w-16 sm:h-16",
        selected ? "bg-gold text-ink" : "bg-white text-ink-soft",
        disabled
          ? "opacity-60 cursor-not-allowed"
          : "cursor-pointer hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0 active:translate-y-0",
      ].join(" ")}
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      Draw
    </button>
  );
}
