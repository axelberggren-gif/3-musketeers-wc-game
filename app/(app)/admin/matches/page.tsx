import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { isoToLocal } from "@/lib/utils";

export default async function AdminMatchesPage() {
  const supabase = await supabaseServer();
  const { data: matches } = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, stage, group_letter, status, home_score, away_score, home:home_team_id(name, code), away:away_team_id(name, code)",
    )
    .order("kickoff_at");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Matches</h1>
      <p className="text-sm text-[var(--muted)]">
        Click a match to override its result. Useful when the API is late or wrong.
      </p>
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-2)] text-[var(--muted)] text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">When</th>
              <th className="text-left px-4 py-2">Stage</th>
              <th className="text-left px-4 py-2">Match</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Score</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {(matches ?? []).map((m) => {
              const home = Array.isArray(m.home) ? m.home[0] : m.home;
              const away = Array.isArray(m.away) ? m.away[0] : m.away;
              return (
                <tr key={m.id}>
                  <td className="px-4 py-2 font-mono text-xs">{isoToLocal(m.kickoff_at)}</td>
                  <td className="px-4 py-2">
                    {m.stage}
                    {m.group_letter ? ` · ${m.group_letter}` : ""}
                  </td>
                  <td className="px-4 py-2">
                    {(home?.name ?? "TBD")} vs {(away?.name ?? "TBD")}
                  </td>
                  <td className="px-4 py-2">{m.status}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {m.home_score ?? "–"} : {m.away_score ?? "–"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/matches/${m.id}`} className="text-[var(--accent)] text-sm">
                      Edit →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
