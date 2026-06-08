"use client";

import { useTransition, useState } from "react";

interface Props {
  label?: string;
  initial: boolean | null;
  yesLabel?: string;
  noLabel?: string;
  disabled: boolean;
  onSave: (value: boolean | null) => Promise<{ ok: boolean; error?: string }>;
}

// Yes/No picker with the same optimistic-update-with-rollback contract as
// TeamSelect / PlayerSelect. The empty option clears the pick (null). Used for
// the boolean "house special" props (Neymar minutes, streaker).
export function BooleanSelect({
  label,
  initial,
  yesLabel = "Yes",
  noLabel = "No",
  disabled,
  onSave,
}: Props) {
  const [value, setValue] = useState<boolean | null>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value;
    const next = raw === "" ? null : raw === "yes";
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
        value={value == null ? "" : value ? "yes" : "no"}
        onChange={handleChange}
        disabled={disabled || pending}
        className="input"
      >
        <option value="">— pick one —</option>
        <option value="yes">{yesLabel}</option>
        <option value="no">{noLabel}</option>
      </select>
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
