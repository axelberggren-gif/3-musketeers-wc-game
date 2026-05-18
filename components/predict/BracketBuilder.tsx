"use client";

import { useState, useTransition } from "react";
import { setBracketPick } from "@/lib/predictions/actions";
import { CountryFlag } from "@/components/CountryFlag";
import { Check } from "lucide-react";

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

export function BracketBuilder({ slots, initial, locked }: Props) {
  const grouped = slots.reduce<Record<string, BracketSlot[]>>((acc, s) => {
    (acc[s.stage] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      {(["R16", "QF", "SF", "F", "W"] as const).map((stage) =>
        grouped[stage] ? (
          <div key={stage} className="flex flex-col gap-3">
            <h3 className="text-sm uppercase tracking-wide text-[var(--muted)]">
              {stageLabel(stage)}
            </h3>
            {grouped[stage].map((s) => (
              <SlotCard
                key={s.slot}
                slot={s}
                initial={initial[s.slot] ?? null}
                locked={locked}
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
}: {
  slot: BracketSlot;
  initial: string | null;
  locked: boolean;
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

  return (
    <div className="card flex flex-col gap-3 min-h-[160px]">
      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{slot.label}</span>
        {!locked && value && (
          <span className="badge text-[var(--accent)]">
            <Check className="w-3 h-3" /> Saved
          </span>
        )}
        {locked && <span className="badge">Locked</span>}
      </div>
      {selected ? (
        <div className="flex items-center gap-2">
          <CountryFlag
            crestUrl={selected.crest_url}
            code={selected.code}
            name={selected.name}
            size={32}
          />
          <span className="font-medium text-sm">{selected.name}</span>
        </div>
      ) : (
        <div className="text-sm text-[var(--muted)]">Not picked yet</div>
      )}
      <select
        value={value ?? ""}
        onChange={handleChange}
        disabled={locked || pending}
        className="input text-sm"
      >
        <option value="">— pick a team —</option>
        {slot.options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
