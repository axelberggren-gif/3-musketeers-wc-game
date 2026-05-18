import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { loadProfileStats } from "@/lib/stats/profile";
import { AccuracyChart } from "@/components/stats/AccuracyChart";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await supabaseServer();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, created_at")
    .eq("username", username)
    .maybeSingle();
  if (!profile) notFound();

  const stats = await loadProfileStats(profile.id);

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="badge w-fit">Player</span>
        <h1 className="text-3xl font-bold">{profile.display_name ?? profile.username}</h1>
        <p className="text-sm text-[var(--muted)]">@{profile.username}</p>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total points" value={stats.totalPoints} />
        <Stat label="Accuracy (1X2)" value={`${stats.accuracy}%`} />
        <Stat label="Picks made" value={stats.picksMade} />
        <Stat label="Correct" value={stats.picksScored} />
      </section>

      <section className="card flex flex-col gap-3">
        <h2 className="font-semibold">Points over time</h2>
        <AccuracyChart data={stats.pointsByDay} />
      </section>

      <section className="grid sm:grid-cols-4 gap-3">
        <Stat label="1X2" value={stats.matchPoints} subtle />
        <Stat label="Bracket" value={stats.bracketPoints} subtle />
        <Stat label="Tournament" value={stats.tournamentPoints} subtle />
        <Stat label="Props" value={stats.propPoints} subtle />
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  subtle,
}: {
  label: string;
  value: string | number;
  subtle?: boolean;
}) {
  return (
    <div className={`card flex flex-col gap-1 ${subtle ? "" : ""}`}>
      <p className="text-xs text-[var(--muted)] uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
