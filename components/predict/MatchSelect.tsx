"use client";

import { useTransition, useState } from "react";

export interface MatchOption {
  id: string;
  label: string;
}

interface Props {
  label?: string;
  options: MatchOption[];
  initial: string | null;
  disabled: boolean;
  onSave: (matchId: string | null) => Promise<{ ok: boolean; error?: string }>;
}

// Dropdown over matches (labels are built server-side, e.g. "SWE vs DEN ·
// Group A"). Same optimistic-update-with-rollback contract as TeamSelect. Used
// by the "war game" prop (which group match collects the most cards).
export function MatchSelect({ label, options, initial, disabled, onSave }: Props) {
  const [value, setValue] = useState<string | null>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null;
    const previous = value;
    setValue(next);
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
      <select
        value={value ?? ""}
        onChange={handleChange}
        disabled={disabled || pending}
        className="input"
      >
        <option value="">{options.length === 0 ? "— fixtures not loaded yet —" : "— pick a match —"}</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
