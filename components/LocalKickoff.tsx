"use client";

import { useEffect, useState } from "react";
import { isoToLocal } from "@/lib/utils";

interface Props {
  iso: string;
  /** Extra Intl options merged over isoToLocal's defaults (same contract). */
  options?: Intl.DateTimeFormatOptions;
  className?: string;
}

/**
 * Renders a kickoff timestamp in the viewer's local timezone without a
 * hydration mismatch. `isoToLocal` formats in the runtime's timezone, so
 * calling it during SSR (Vercel = UTC) shows every user UTC times, and a
 * hydration-time call tears the DOM (Sentry JAVASCRIPT-NEXTJS-5). SSR + the
 * first client render emit a stable placeholder; a rAF-driven effect swaps in
 * the localized string after mount — same pattern as MatchPickCard /
 * GroupStageList / CountdownBanner.
 */
export function LocalKickoff({ iso, options, className }: Props) {
  const [label, setLabel] = useState<string | null>(null);
  // Call sites pass `options` as an object literal, so its identity changes
  // every render — key the effect on its serialized form instead.
  const optionsKey = JSON.stringify(options ?? null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setLabel(isoToLocal(iso, options)));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, optionsKey]);
  return (
    <span className={className} suppressHydrationWarning>
      {label ?? "—"}
    </span>
  );
}
