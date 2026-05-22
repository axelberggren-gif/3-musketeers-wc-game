import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { loadProfileStats } from "@/lib/stats/profile";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await supabaseServer();
  const [{ data: profile }, { data: viewerData }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, created_at")
      .eq("username", username)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!profile) notFound();

  const stats = await loadProfileStats(profile.id, viewerData.user?.id);

  const initial = (profile.display_name ?? profile.username).slice(0, 1).toUpperCase();

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="card flex items-center gap-4 sm:gap-5">
        <div
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-gold border-2 border-ink flex items-center justify-center font-display text-4xl sm:text-5xl"
          style={{ boxShadow: "4px 4px 0 var(--ink)" }}
          aria-hidden
        >
          {initial}
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="badge badge-pitch self-start !text-[10px]">Player</span>
          <h1 className="font-display uppercase text-3xl sm:text-4xl leading-none tracking-tight truncate">
            {profile.display_name ?? profile.username}
          </h1>
          <p className="font-mono-sticker text-xs text-ink-soft">@{profile.username}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Points" value={stats.totalPoints} accent="gold" />
        {stats.accuracy !== null ? (
          <Stat label="Acc. 1X2" value={`${stats.accuracy}%`} accent="pitch" />
        ) : (
          <Stat label="Acc. 1X2" value="—" accent="pitch" />
        )}
        <Stat label="Picks" value={stats.picksMade ?? 0} accent="coral" />
        <Stat label="Correct" value={stats.picksScored} accent="paper" />
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="1X2" value={stats.matchPoints} subtle />
        <Stat label="Bracket" value={stats.bracketPoints} subtle />
        <Stat label="Tournament" value={stats.tournamentPoints} subtle />
        <Stat label="Props" value={stats.propPoints} subtle />
      </section>

      <section
        className="card flex flex-col gap-3"
        style={{ boxShadow: "4px 4px 0 var(--coral)" }}
      >
        <span
          className="badge badge-gold self-start !text-[10px]"
          style={{ boxShadow: "2px 2px 0 var(--ink)" }}
        >
          Pick personality
        </span>
        <p className="text-sm text-ink-soft">
          Pick-mix bar, you-vs-league comparison bars and boldness stats are coming once the
          cohort aggregation queries land — see{" "}
          <code className="font-mono-sticker text-xs">DESIGN_MISALIGNMENTS.md</code>.
        </p>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
  subtle,
}: {
  label: string;
  value: string | number;
  accent?: "gold" | "pitch" | "coral" | "paper";
  subtle?: boolean;
}) {
  const bg =
    subtle || !accent
      ? "bg-white"
      : accent === "gold"
        ? "bg-gold"
        : accent === "pitch"
          ? "bg-pitch text-white"
          : accent === "coral"
            ? "bg-coral text-white"
            : "bg-paper-2";
  return (
    <div
      className={`rounded-xl border-2 border-ink p-3 sm:p-4 flex flex-col gap-1 ${bg}`}
      style={{ boxShadow: "3px 3px 0 var(--ink)" }}
    >
      <p className="font-mono-sticker text-[10px] uppercase tracking-widest font-medium opacity-80">
        {label}
      </p>
      <p className="font-display text-2xl sm:text-3xl tabular-nums leading-none">{value}</p>
    </div>
  );
}
