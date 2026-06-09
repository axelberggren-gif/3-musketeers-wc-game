"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavTab = {
  href: string;
  label: string;
  /** Match the route exactly (no prefix match). Needed for `/predict`, which is a
   *  prefix of `/predict/outcomes` + `/predict/bracket` and would otherwise stay lit
   *  on those sibling tabs. */
  exact?: boolean;
};

function isActive(pathname: string, t: NavTab): boolean {
  return t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + "/");
}

// Shared pill chrome so the desktop strip and the mobile trigger stay in sync.
const PILL_BASE =
  "font-display text-[11px] sm:text-xs uppercase tracking-wider px-3 py-1.5 rounded-full border-2 whitespace-nowrap transition-colors";
// The active look is the former hover look, made persistent (the "you are here" cue).
const PILL_ACTIVE = "bg-gold border-ink text-ink [box-shadow:3px_3px_0_var(--ink)]";
const PILL_INACTIVE =
  "border-transparent text-ink hover:bg-gold hover:border-ink hover:[box-shadow:3px_3px_0_var(--ink)]";

/**
 * Route-aware tab navigation. Renders two layouts off the `lg` breakpoint: an inline
 * pill strip on desktop and a compact dropdown below `lg` (so phones/tablets never
 * side-scroll the tabs). The active tab is highlighted in both, and on mobile the
 * dropdown trigger shows the current tab's name — so you always know where you are.
 */
export function NavTabs({ tabs }: { tabs: NavTab[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const active = tabs.find((t) => isActive(pathname, t)) ?? null;

  // Dismiss on outside click / Escape (mirrors PlayerSelect's popover). Tab
  // selection closes the panel via each link's onClick; outside-click covers the
  // logo / profile / sign-out taps — so no separate route-change effect is needed.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/* Desktop: inline pill strip (fits max-w-6xl with no scroll). */}
      <div className="hidden lg:flex gap-1.5">
        {tabs.map((t) => {
          const on = isActive(pathname, t);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`${PILL_BASE} ${on ? PILL_ACTIVE : PILL_INACTIVE}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* Mobile/tablet: compact dropdown — trigger shows the current tab. */}
      <div className="relative lg:hidden" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`${PILL_BASE} inline-flex items-center gap-1.5 ${active ? PILL_ACTIVE : PILL_INACTIVE}`}
        >
          <span>{active?.label ?? "Menu"}</span>
          <span
            aria-hidden
            className={`text-[0.7em] leading-none transition-transform ${open ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full mt-2 z-30 flex min-w-[12rem] flex-col gap-1 rounded-xl border-2 border-ink bg-white p-1.5 [box-shadow:4px_4px_0_var(--ink)]"
          >
            {tabs.map((t) => {
              const on = isActive(pathname, t);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  role="menuitem"
                  aria-current={on ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`font-display text-xs uppercase tracking-wider px-3 py-2 rounded-lg border-2 ${
                    on ? "bg-gold border-ink text-ink" : "border-transparent text-ink hover:bg-paper-2"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {t.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
