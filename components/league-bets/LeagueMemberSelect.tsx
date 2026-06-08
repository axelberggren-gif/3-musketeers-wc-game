"use client";

import { useState, useTransition } from "react";

export interface MemberOption {
  id: string;
  label: string;
}

interface Props {
  label?: string;
  options: MemberOption[];
  initial: string | null;
  disabled: boolean;
  placeholder?: string;
  onSave: (memberId: string | null) => Promise<{ ok: boolean; error?: string }>;
}

// Generic "pick a league member" dropdown. Same optimistic-update-with-rollback
// pattern as components/predict/TeamSelect.tsx.
export function LeagueMemberSelect({
  label,
  options,
  initial,
  disabled,
  placeholder,
  onSave,
}: Props) {
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
        <option value="">{placeholder ?? "— pick a member —"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
