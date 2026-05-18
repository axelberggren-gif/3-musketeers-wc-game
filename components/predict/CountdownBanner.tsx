"use client";

import { useEffect, useState } from "react";

interface Props {
  target: string;
  label: string;
  lockedLabel?: string;
}

export function CountdownBanner({ target, label, lockedLabel = "Picks locked." }: Props) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(target).getTime() - Date.now()));

  useEffect(() => {
    const i = setInterval(() => {
      setRemaining(Math.max(0, new Date(target).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(i);
  }, [target]);

  if (remaining <= 0) {
    return (
      <div className="card border-[var(--danger)] bg-[color:var(--danger)]/10">
        <p className="text-sm font-medium text-[var(--danger)]">{lockedLabel}</p>
      </div>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="card flex items-center justify-between flex-wrap gap-3">
      <div>
        <p className="text-xs text-[var(--muted)]">{label}</p>
        <p className="text-lg font-semibold">
          {days}d {hours.toString().padStart(2, "0")}h {minutes.toString().padStart(2, "0")}m {seconds.toString().padStart(2, "0")}s
        </p>
      </div>
      <span className="badge text-[var(--accent)]">Picks autosave</span>
    </div>
  );
}
