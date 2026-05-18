import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Trophy, Goal, Users, Sparkles } from "lucide-react";

export default async function Home() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/leagues");

  return (
    <main className="flex-1 flex flex-col items-center px-6 pt-20 pb-24">
      <div className="max-w-3xl w-full text-center flex flex-col items-center gap-6">
        <span className="badge">World Cup 2026 · USA · Canada · Mexico</span>
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-tight">
          Predict every game.{" "}
          <span className="text-[var(--accent)]">Beat your friends.</span>
        </h1>
        <p className="text-lg text-[var(--muted)] max-w-xl">
          A friends-only prediction game for the 2026 World Cup. Lock in your group-stage picks,
          fill the knockout bracket, and chase the leaderboard.
        </p>
        <div className="flex gap-3 mt-4">
          <Link href="/login" className="btn btn-primary">
            Sign in to play
          </Link>
          <a href="#how" className="btn btn-secondary">
            How it works
          </a>
        </div>
      </div>

      <section id="how" className="mt-24 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl w-full">
        <FeatureCard
          icon={<Goal className="w-5 h-5" />}
          title="Round 1 — Group stage"
          body="Pick 1X2 for all 48 group games + the tournament winner, top scorer, dark horse and player props. Editable until first kickoff."
        />
        <FeatureCard
          icon={<Trophy className="w-5 h-5" />}
          title="Round 2 — Bracket"
          body="Once the groups conclude, fill the entire R16 → Final bracket. Locks at R16 kickoff."
        />
        <FeatureCard
          icon={<Users className="w-5 h-5" />}
          title="Private leagues"
          body="Compete in private leagues with friends, colleagues, or family. Invite via shareable link."
        />
        <FeatureCard
          icon={<Sparkles className="w-5 h-5" />}
          title="Live leaderboard"
          body="Points update as matches finish. See friends' picks once the whistle blows, never before."
        />
      </section>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="card flex flex-col gap-3">
      <div className="w-9 h-9 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-[var(--accent)]">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-[var(--muted)]">{body}</p>
    </div>
  );
}
