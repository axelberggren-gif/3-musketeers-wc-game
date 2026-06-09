"use client";

import { useState, useTransition } from "react";

interface Props {
  label?: string;
  initial: number | null;
  min: number;
  /** Optional upper bound. Omit for an unbounded input (only `min` is enforced). */
  max?: number;
  disabled: boolean;
  onSave: (value: number | null) => Promise<{ ok: boolean; error?: string }>;
}

export function NumberInput({ label, initial, min, max, disabled, onSave }: Props) {
  const [value, setValue] = useState<string>(initial != null ? String(initial) : "");
  // The input is controlled, so by the time commit() fires on blur `value` is
  // already the freshly-typed text — capturing it as the rollback target would
  // "restore" the rejected value. Roll back to the last server-accepted value
  // instead.
  const [lastSaved, setLastSaved] = useState<string>(initial != null ? String(initial) : "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function commit(raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next != null && (!Number.isInteger(next) || next < min || (max != null && next > max))) {
      setError(
        max != null
          ? `Pick an integer between ${min} and ${max}.`
          : `Pick an integer of ${min} or more.`,
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        setValue(lastSaved);
        setError(result.error ?? "Failed to save");
      } else {
        setLastSaved(next != null ? String(next) : "");
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
        placeholder={max != null ? `${min}–${max}` : `${min}+`}
      />
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
