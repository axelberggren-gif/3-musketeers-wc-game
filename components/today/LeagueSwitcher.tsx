"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type LeagueOption = { slug: string; name: string };

/**
 * Pill toggle between the viewer's leagues on /today (`?league=<slug>` drives a
 * server refetch). Only mounted when the viewer is in more than one league —
 * with a single league the page renders a static league-name badge instead.
 */
export function LeagueSwitcher({
  options,
  active,
}: {
  options: LeagueOption[];
  active: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2" aria-label="Switch league">
      {options.map((o) => {
        const isActive = o.slug === active;
        return (
          <button
            key={o.slug}
            type="button"
            aria-pressed={isActive}
            disabled={pending}
            onClick={() => {
              if (isActive) return;
              startTransition(() =>
                router.push(`/today?league=${encodeURIComponent(o.slug)}`),
              );
            }}
            className={[
              "inline-flex items-center rounded-full border-2 border-ink font-display uppercase text-[11px] tracking-wider px-3 py-1 disabled:opacity-60",
              isActive ? "bg-gold text-ink" : "bg-white text-ink",
            ].join(" ")}
            style={{ boxShadow: "3px 3px 0 var(--ink)" }}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}
