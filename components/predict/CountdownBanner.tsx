"use client";

import { useEffect, useState } from "react";

interface Props {
  target: string;
  label: string;
  lockedLabel?: string;
}

export function CountdownBanner({ target, label, lockedLabel = "Picks locked." }: Props) {
  // remaining stays null until the client-side useEffect runs. The server
  // renders a tick-less placeholder so the SSR HTML doesn't depend on
  // `Date.now()` (which would differ from the value computed at hydration
  // time and trigger a React hydration mismatch).
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, new Date(target).getTime() - Date.now()));
    // Schedule the first tick async so the SSR render and the hydration render
    // both produce the `--:--:--` placeholder; once mounted the interval drives
    // the countdown.
    const raf = requestAnimationFrame(tick);
    const i = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(i);
    };
  }, [target]);

  if (remaining === null) {
    return (
      <div
        className="card !p-4 flex items-center justify-between gap-4 flex-wrap"
        style={{ boxShadow: "4px 4px 0 var(--coral)" }}
      >
        <div>
          <p className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft font-medium">
            {label}
          </p>
          <p className="font-display text-2xl sm:text-3xl text-coral tracking-wider tabular-nums leading-none mt-1">
            --:--:--
          </p>
        </div>
        <span className="badge badge-pitch">Autosaves</span>
      </div>
    );
  }

  if (remaining <= 0) {
    return (
      <div
        className="rounded-xl border-2 border-ink bg-red text-white px-4 py-3 font-display uppercase tracking-widest text-sm"
        style={{ boxShadow: "4px 4px 0 var(--ink)" }}
      >
        ⏰ {lockedLabel}
      </div>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <div
      className="card !p-4 flex items-center justify-between gap-4 flex-wrap"
      style={{ boxShadow: "4px 4px 0 var(--coral)" }}
    >
      <div>
        <p className="font-mono-sticker text-[11px] uppercase tracking-widest text-ink-soft font-medium">
          {label}
        </p>
        <p className="font-display text-2xl sm:text-3xl text-coral tracking-wider tabular-nums leading-none mt-1">
          {days > 0 && <span>{days}d&nbsp;</span>}
          {pad(hours)}:{pad(minutes)}:{pad(seconds)}
        </p>
      </div>
      <span className="badge badge-pitch">Autosaves</span>
    </div>
  );
}
