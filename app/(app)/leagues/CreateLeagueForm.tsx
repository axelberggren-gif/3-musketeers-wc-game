"use client";

import { useActionState } from "react";
import { createLeague, type CreateLeagueState } from "@/lib/leagues/actions";

export function CreateLeagueForm() {
  const [state, formAction, pending] = useActionState<CreateLeagueState, FormData>(
    createLeague,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
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
      {state?.error && <p className="text-sm text-[var(--danger)]">{state.error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? "Creating…" : "Create league"}
      </button>
    </form>
  );
}
