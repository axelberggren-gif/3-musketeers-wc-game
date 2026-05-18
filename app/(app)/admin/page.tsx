import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { isoToLocal } from "@/lib/utils";

export default async function AdminDashboard() {
  const supabase = await supabaseServer();
  const [matchesRes, awardsRes, syncRes, tournamentRes] = await Promise.all([
    supabase
      .from("matches")
      .select("id, status, kickoff_at")
      .order("kickoff_at", { ascending: true }),
    supabase.from("point_awards").select("id, awarded_at").order("awarded_at", { ascending: false }).limit(1),
    supabase
      .from("external_sync_log")
      .select("*")
      .order("ran_at", { ascending: false })
      .limit(10),
    supabase.from("tournament").select("*").single(),
  ]);

  const matches = matchesRes.data ?? [];
  const total = matches.length;
  const finished = matches.filter((m) => m.status === "FINISHED").length;
  const scheduled = matches.filter((m) => m.status === "SCHEDULED").length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Admin dashboard</h1>
      <div className="grid sm:grid-cols-4 gap-3">
        <Card label="Matches loaded" value={total} />
        <Card label="Finished" value={finished} />
        <Card label="Scheduled" value={scheduled} />
        <Card
          label="Latest scoring"
          value={
            awardsRes.data?.[0] ? isoToLocal(awardsRes.data[0].awarded_at) : "—"
          }
        />
      </div>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">Tournament window</h2>
        {tournamentRes.data ? (
          <ul className="text-sm flex flex-col gap-1">
            <li>First kickoff: <span className="font-mono">{isoToLocal(tournamentRes.data.first_kickoff_at)}</span></li>
            <li>Knockouts start: <span className="font-mono">{isoToLocal(tournamentRes.data.knockout_start_at)}</span></li>
            <li>Final: <span className="font-mono">{isoToLocal(tournamentRes.data.final_at)}</span></li>
          </ul>
        ) : (
          <p className="text-sm text-[var(--muted)]">No tournament row yet.</p>
        )}
        <Link href="/admin/tournament" className="text-sm text-[var(--accent)]">
          Edit dates →
        </Link>
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">Recent sync log</h2>
        {(syncRes.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No sync history yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm font-mono">
            {(syncRes.data ?? []).map((row) => (
              <li key={row.id} className="py-1.5 flex items-center justify-between gap-3">
                <span className="text-[var(--muted)] w-44 shrink-0">
                  {isoToLocal(row.ran_at, { weekday: undefined })}
                </span>
                <span className="text-[var(--muted)] w-32 shrink-0 truncate">{row.endpoint}</span>
                <span className="flex-1 truncate">{row.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-xs text-[var(--muted)] uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
