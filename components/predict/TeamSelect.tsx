"use client";

import { useTransition, useState } from "react";

export interface TeamOption {
  id: string;
  name: string;
  code: string;
}

interface Props {
  label: string;
  options: TeamOption[];
  initial: string | null;
  disabled: boolean;
  onSave: (teamId: string | null) => Promise<{ ok: boolean; error?: string }>;
}

export function TeamSelect({ label, options, initial, disabled, onSave }: Props) {
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
      <label className="label">{label}</label>
      <select
        value={value ?? ""}
        onChange={handleChange}
        disabled={disabled || pending}
        className="input"
      >
        <option value="">— pick a team —</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
