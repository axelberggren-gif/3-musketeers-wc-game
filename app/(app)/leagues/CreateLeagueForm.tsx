"use client";

import { useTransition, useState } from "react";
import { createLeague } from "@/lib/leagues/actions";

export function CreateLeagueForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createLeague(formData);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="label">
          Name
        </label>
        <input id="name" name="name" required className="input" placeholder="Office WC pool" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="label">
          Description (optional)
        </label>
        <textarea id="description" name="description" className="input" rows={2} />
      </div>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? "Creating…" : "Create league"}
      </button>
    </form>
  );
}
