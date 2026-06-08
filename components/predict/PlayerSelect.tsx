"use client";

import { useTransition, useState } from "react";

export interface PlayerOption {
  id: string;
  name: string;
  team_name?: string | null;
}

interface Props {
  label?: string;
  options: PlayerOption[];
  initial: string | null;
  disabled: boolean;
  onSave: (playerId: string | null) => Promise<{ ok: boolean; error?: string }>;
}

export function PlayerSelect({ label, options, initial, disabled, onSave }: Props) {
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
        <option value="">— pick a player —</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.team_name ? ` · ${p.team_name}` : ""}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
