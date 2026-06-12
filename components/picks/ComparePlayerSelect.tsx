"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export interface CompareOption {
  username: string;
  label: string;
}

interface Props {
  /** Which side of the comparison this select controls. */
  slot: "a" | "b";
  /** Username currently occupying this slot. */
  value: string;
  /** Username occupying the other slot (kept in the URL on swap). */
  other: string;
  /** League-mates the viewer may swap in (RLS can reveal their picks). */
  options: CompareOption[];
  label: string;
}

/**
 * Swaps one side of `/compare` for another league member by pushing the updated
 * `?a=&b=` query — the server page refetches both pick sets through RLS.
 */
export function ComparePlayerSelect({ slot, value, other, options, label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // A slot can hold someone outside the viewer's leagues (deep link); keep them
  // selectable so the control reflects the URL instead of snapping elsewhere.
  const fullOptions = options.some((o) => o.username === value)
    ? options
    : [{ username: value, label: value }, ...options];

  function choose(username: string) {
    const a = slot === "a" ? username : other;
    const b = slot === "b" ? username : other;
    startTransition(() => {
      router.push(`/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    });
  }

  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="label">{label}</span>
      <select
        className="input"
        value={value}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
      >
        {fullOptions.map((o) => (
          <option key={o.username} value={o.username}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
