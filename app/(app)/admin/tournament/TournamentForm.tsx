"use client";

import { useTransition, useState } from "react";
import { setTournamentDates } from "@/lib/admin/actions";

function toLocalInput(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function TournamentForm({
  first,
  ko,
  final,
}: {
  first: string;
  ko: string;
  final: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handle(formData: FormData) {
    setError(null);
    setSaved(false);
    // datetime-local values are timezone-less local wall time. Convert to UTC
    // ISO here — `new Date(value)` interprets the string in the browser's
    // timezone, exactly inverting toLocalInput's display conversion — so
    // Postgres stores the same instant the admin saw. Submitting the raw
    // string made Postgres read local wall time as UTC, shifting the round
    // locks by the admin's UTC offset on every save.
    for (const name of ["first_kickoff_at", "knockout_start_at", "final_at"]) {
      const raw = String(formData.get(name) ?? "");
      const parsed = new Date(raw);
      if (!raw || Number.isNaN(parsed.getTime())) {
        setError("All three dates are required.");
        return;
      }
      formData.set(name, parsed.toISOString());
    }
    startTransition(async () => {
      const result = await setTournamentDates(formData);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <form action={handle} className="card flex flex-col gap-3">
      <Field name="first_kickoff_at" label="First kickoff" defaultValue={toLocalInput(first)} />
      <Field name="knockout_start_at" label="Knockout start (R16)" defaultValue={toLocalInput(ko)} />
      <Field name="final_at" label="Final" defaultValue={toLocalInput(final)} />
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      {saved && <p className="text-sm text-[var(--accent)]">Saved.</p>}
      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? "Saving…" : "Save dates"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="label">{label}</label>
      <input type="datetime-local" name={name} defaultValue={defaultValue} className="input" />
    </div>
  );
}
