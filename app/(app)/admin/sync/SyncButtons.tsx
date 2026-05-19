"use client";

import { useState, useTransition } from "react";
import {
  runCheckToken,
  runSeedTeams,
  runSyncFixtures,
  runSyncScorers,
} from "@/lib/admin/actions";

type ActionResult = { ok: boolean; error?: string } & Record<string, unknown>;

export function SyncButtons() {
  const [pending, startTransition] = useTransition();
  const [log, setLog] = useState<string[]>([]);

  function run(name: string, fn: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await fn();
      const detail = result.ok
        ? Object.entries(result)
            .filter(([k]) => k !== "ok")
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(" ") || "ok"
        : `error — ${result.error}`;
      setLog((l) => [`[${new Date().toLocaleTimeString()}] ${name}: ${detail}`, ...l]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run("Check token", runCheckToken)}
          disabled={pending}
          className="btn btn-secondary"
        >
          Check token
        </button>
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
