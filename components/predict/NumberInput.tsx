"use client";

import { useState, useTransition } from "react";

interface Props {
  label?: string;
  initial: number | null;
  min: number;
  max: number;
  disabled: boolean;
  onSave: (value: number | null) => Promise<{ ok: boolean; error?: string }>;
}

export function NumberInput({ label, initial, min, max, disabled, onSave }: Props) {
  const [value, setValue] = useState<string>(initial != null ? String(initial) : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function commit(raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next != null && (!Number.isInteger(next) || next < min || next > max)) {
      setError(`Pick an integer between ${min} and ${max}.`);
      return;
    }
    const previous = value;
    setError(null);
    startTransition(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        setValue(previous);
        setError(result.error ?? "Failed to save");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {label ? <label className="label">{label}</label> : null}
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        disabled={disabled || pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        className="input"
        placeholder={`${min}–${max}`}
      />
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
