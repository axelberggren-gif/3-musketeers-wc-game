"use client";

import { useState, useTransition } from "react";
import { runSeedTeams, runSyncFixtures, runSyncScorers } from "@/lib/admin/actions";

export function SyncButtons() {
  const [pending, startTransition] = useTransition();
  const [log, setLog] = useState<string[]>([]);

  function run(name: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      setLog((l) => [
        `[${new Date().toLocaleTimeString()}] ${name}: ${result.ok ? "ok" : `error — ${result.error}`}`,
        ...l,
      ]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run("Seed teams + players", runSeedTeams)}
          disabled={pending}
          className="btn btn-primary"
        >
          Seed teams + players
        </button>
        <button
          onClick={() => run("Sync fixtures + results", runSyncFixtures)}
          disabled={pending}
          className="btn btn-secondary"
        >
          Sync fixtures + results
        </button>
        <button
          onClick={() => run("Sync scorers", runSyncScorers)}
          disabled={pending}
          className="btn btn-secondary"
        >
          Sync scorers
        </button>
      </div>
      <div className="card text-sm font-mono whitespace-pre-wrap">
        {log.length === 0 ? (
          <span className="text-[var(--muted)]">Run history will appear here.</span>
        ) : (
          log.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
}
