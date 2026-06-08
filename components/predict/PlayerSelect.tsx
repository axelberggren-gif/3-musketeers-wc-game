"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CountryFlag } from "@/components/CountryFlag";
import { normalizePosition, POSITION_FILTERS, type PositionGroup } from "@/lib/players/position";

export interface PlayerOption {
  id: string;
  name: string;
  team_name?: string | null;
  position?: string | null;
  team_code?: string | null;
  team_crest?: string | null;
}

interface Props {
  label?: string;
  options: PlayerOption[];
  initial: string | null;
  disabled: boolean;
  onSave: (playerId: string | null) => Promise<{ ok: boolean; error?: string }>;
}

// The WC 2026 catalogue is ~1,100 players, so the picker is a searchable +
// filterable combobox rather than a native <select>: filter by name/country
// search, by position (DEF/MID/ATT/GK), and by country. Render is capped so
// opening with no filter stays snappy; the user narrows with search/filters.
const RESULT_CAP = 100;

/**
 * Searchable, filterable player picker. Keeps the same `onSave` optimistic-save
 * contract as the old <select> (set value immediately, roll back on `!ok`) so
 * the OutcomesBoard wiring is unchanged.
 */
export function PlayerSelect({ label, options, initial, disabled, onSave }: Props) {
  const [value, setValue] = useState<string | null>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [posFilter, setPosFilter] = useState<PositionGroup | null>(null);
  const [countryFilter, setCountryFilter] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  // Distinct team names (= countries at the WC) for the country dropdown.
  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const p of options) if (p.team_name) set.add(p.team_name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [options]);

  // Only offer the position pills when at least one player has a resolvable
  // position — otherwise (positions not yet synced) they'd be dead filters.
  const hasAnyPosition = useMemo(
    () => options.some((p) => normalizePosition(p.position) != null),
    [options],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((p) => {
      if (posFilter && normalizePosition(p.position) !== posFilter) return false;
      if (countryFilter && (p.team_name ?? "") !== countryFilter) return false;
      if (q && !`${p.name} ${p.team_name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [options, query, posFilter, countryFilter]);

  const visible = matches.slice(0, RESULT_CAP);
  const moreCount = matches.length - visible.length;

  // Close on outside click / Escape, and focus the search box when opening.
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
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [open]);

  function select(next: string | null) {
    const previous = value;
    setValue(next);
    setError(null);
    setOpen(false);
    startTransition(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        setValue(previous);
        setError(result.error ?? "Failed to save");
      }
    });
  }

  const triggerDisabled = disabled || pending;

  return (
    <div className="flex flex-col gap-2">
      {label ? <label className="label">{label}</label> : null}
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => !triggerDisabled && setOpen((o) => !o)}
          disabled={triggerDisabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={[
            "input flex items-center justify-between gap-2 text-left",
            triggerDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          <span className="flex items-center gap-2 min-w-0">
            {selected ? (
              <>
                <CountryFlag
                  crestUrl={selected.team_crest}
                  code={selected.team_code}
                  name={selected.team_name ?? selected.name}
                  size={18}
                  className="rounded-sm shrink-0"
                />
                <span className="truncate">
                  {selected.name}
                  {selected.team_name ? ` · ${selected.team_name}` : ""}
                </span>
              </>
            ) : (
              <span className="text-ink-soft">— pick a player —</span>
            )}
          </span>
          <span aria-hidden className="shrink-0 text-ink-soft">
            ▾
          </span>
        </button>

        {open && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 flex flex-col gap-2 rounded-[12px] border-2 border-ink bg-white p-2"
            style={{ boxShadow: "4px 4px 0 var(--ink)" }}
          >
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search player or country…"
              className="input"
              style={{ boxShadow: "2px 2px 0 var(--ink)" }}
              aria-label="Search players"
            />

            {hasAnyPosition && (
              <div className="flex flex-wrap gap-1.5">
                <Pill active={posFilter === null} onClick={() => setPosFilter(null)}>
                  All
                </Pill>
                {POSITION_FILTERS.map((f) => (
                  <Pill
                    key={f.key}
                    active={posFilter === f.key}
                    onClick={() => setPosFilter((cur) => (cur === f.key ? null : f.key))}
                  >
                    {f.label}
                  </Pill>
                ))}
              </div>
            )}

            {countries.length > 1 && (
              <select
                value={countryFilter ?? ""}
                onChange={(e) => setCountryFilter(e.target.value || null)}
                className="input"
                style={{ boxShadow: "2px 2px 0 var(--ink)" }}
                aria-label="Filter by country"
              >
                <option value="">All countries</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}

            <div className="max-h-[18rem] overflow-y-auto flex flex-col gap-1">
              {value != null && (
                <button
                  type="button"
                  onClick={() => select(null)}
                  className="w-full rounded-[8px] border-2 border-dashed border-ink-soft px-2 py-1.5 text-left font-mono-sticker text-[0.65rem] uppercase tracking-widest text-ink-soft hover:bg-paper-2"
                >
                  Clear selection
                </button>
              )}
              {visible.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-ink-soft">No players match.</p>
              ) : (
                visible.map((p) => {
                  const grp = normalizePosition(p.position);
                  const isSel = p.id === value;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={isSel}
                      onClick={() => select(p.id)}
                      className={[
                        "w-full flex items-center gap-2 rounded-[8px] border-2 px-2 py-1.5 text-left",
                        isSel ? "border-ink bg-gold" : "border-transparent hover:bg-paper-2",
                      ].join(" ")}
                    >
                      <CountryFlag
                        crestUrl={p.team_crest}
                        code={p.team_code}
                        name={p.team_name ?? p.name}
                        size={18}
                        className="rounded-sm shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                      {p.team_name ? (
                        <span className="shrink-0 max-w-[38%] truncate text-[0.7rem] text-ink-soft">
                          {p.team_name}
                        </span>
                      ) : null}
                      {grp ? (
                        <span className="shrink-0 rounded border border-ink bg-paper-2 px-1 font-mono-sticker text-[0.55rem] uppercase tracking-wider">
                          {grp}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            {moreCount > 0 && (
              <p className="px-2 text-center font-mono-sticker text-[0.6rem] uppercase tracking-widest text-ink-soft">
                +{moreCount} more — keep typing to narrow
              </p>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center rounded-full border-2 border-ink font-display uppercase text-[11px] tracking-wider px-2.5 py-0.5",
        active ? "bg-gold text-ink" : "bg-white text-ink",
      ].join(" ")}
      style={{ boxShadow: "2px 2px 0 var(--ink)" }}
    >
      {children}
    </button>
  );
}
