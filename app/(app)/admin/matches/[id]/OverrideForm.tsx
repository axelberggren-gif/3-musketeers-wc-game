"use client";

import { useState, useTransition } from "react";
import { overrideMatchResult } from "@/lib/admin/actions";

export function OverrideForm({
  matchId,
  homeScore,
  awayScore,
}: {
  matchId: string;
  homeScore: number;
  awayScore: number;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handle(formData: FormData) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await overrideMatchResult(formData);
      if (result.ok) setMessage("Saved and re-scored.");
      else setError(result.error);
    });
  }

  return (
    <form action={handle} className="card flex flex-col gap-3">
      <input type="hidden" name="match_id" value={matchId} />
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="label">Home score</label>
          <input
            type="number"
            min={0}
            name="home_score"
            defaultValue={homeScore}
            className="input"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="label">Away score</label>
          <input
            type="number"
            min={0}
            name="away_score"
            defaultValue={awayScore}
            className="input"
          />
        </div>
      </div>
      {message && <p className="text-sm text-[var(--accent)]">{message}</p>}
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary self-start">
        {pending ? "Saving…" : "Set result + re-score"}
      </button>
    </form>
  );
}
