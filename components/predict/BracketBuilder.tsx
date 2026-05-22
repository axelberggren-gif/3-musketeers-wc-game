"use client";

import { useState, useTransition } from "react";
import { setBracketPick } from "@/lib/predictions/actions";
import { CountryFlag } from "@/components/CountryFlag";

export interface BracketTeam {
  id: string;
  name: string;
  short_name: string | null;
  code: string;
  crest_url: string | null;
}

export interface BracketSlot {
  slot: string;
  label: string;
  stage: "R16" | "QF" | "SF" | "F" | "W";
  options: BracketTeam[];
}

interface Props {
  slots: BracketSlot[];
  initial: Record<string, string | null>;
  locked: boolean;
}

const STAGE_ORDER = ["R16", "QF", "SF", "F", "W"] as const;

export function BracketBuilder({ slots, initial, locked }: Props) {
  const grouped = slots.reduce<Record<string, BracketSlot[]>>((acc, s) => {
    (acc[s.stage] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
      {STAGE_ORDER.map((stage) =>
        grouped[stage] ? (
          <div key={stage} className="flex flex-col gap-3">
            <h3
              className="font-display uppercase text-xs tracking-widest text-ink bg-paper-2 border-2 border-ink rounded-full px-3 py-1 self-start"
              style={{ boxShadow: "3px 3px 0 var(--ink)" }}
            >
              {stageLabel(stage)}
            </h3>
            {grouped[stage].map((s) => (
              <SlotCard
                key={s.slot}
                slot={s}
                initial={initial[s.slot] ?? null}
                locked={locked}
                stage={stage}
              />
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

function stageLabel(s: "R16" | "QF" | "SF" | "F" | "W") {
  return s === "R16"
    ? "Round of 16"
    : s === "QF"
      ? "Quarter-finals"
      : s === "SF"
        ? "Semi-finals"
        : s === "F"
          ? "Final"
          : "Champion";
}

function SlotCard({
  slot,
  initial,
  locked,
  stage,
}: {
  slot: BracketSlot;
  initial: string | null;
  locked: boolean;
  stage: "R16" | "QF" | "SF" | "F" | "W";
}) {
  const [value, setValue] = useState<string | null>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selected = slot.options.find((o) => o.id === value);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null;
    if (!next) return;
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await setBracketPick(slot.slot, next);
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      }
    });
  }

  const isChampion = stage === "W";

  return (
    <div
      className={[
        "rounded-xl border-2 border-ink p-3 flex flex-col gap-2",
        selected ? "bg-white" : "bg-paper-2",
      ].join(" ")}
      style={{
        boxShadow: selected
          ? isChampion
            ? "5px 5px 0 var(--gold)"
            : "4px 4px 0 var(--ink)"
          : "3px 3px 0 var(--ink)",
        borderStyle: selected ? "solid" : "dashed",
      }}
    >
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-mono-sticker uppercase tracking-widest text-ink-soft font-medium">
          {slot.label}
        </span>
        {locked ? (
          <span className="badge badge-ink !py-0 !text-[10px]">Locked</span>
        ) : value ? (
          <span className="badge badge-pitch !py-0 !text-[10px]">✓</span>
        ) : null}
      </div>
      {selected ? (
        <div className="flex items-center gap-2">
          <CountryFlag
            crestUrl={selected.crest_url}
            code={selected.code}
            name={selected.name}
            size={28}
          />
          <span className="font-display uppercase text-sm tracking-wide">
            {selected.short_name ?? selected.name}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-ink-soft">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border-2 border-dashed border-ink-soft font-display text-base">
            ?
          </span>
          <span className="text-xs font-medium">Not picked</span>
        </div>
      )}
      <select
        value={value ?? ""}
        onChange={handleChange}
        disabled={locked || pending}
        className="input !text-xs !py-1.5"
        style={{ boxShadow: "2px 2px 0 var(--ink)" }}
      >
        <option value="">— pick a team —</option>
        {slot.options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <p className="text-[11px] text-red font-medium">{error}</p>}
    </div>
  );
}
