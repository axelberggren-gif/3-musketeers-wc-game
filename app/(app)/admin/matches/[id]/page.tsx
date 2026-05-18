import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { OverrideForm } from "./OverrideForm";

export default async function AdminMatchEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, status, home_score, away_score, home:home_team_id(name), away:away_team_id(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!match) notFound();
  const home = Array.isArray(match.home) ? match.home[0] : match.home;
  const away = Array.isArray(match.away) ? match.away[0] : match.away;

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Link href="/admin/matches" className="text-sm text-[var(--muted)]">
        ← Matches
      </Link>
      <h1 className="text-2xl font-bold">
        {home?.name ?? "TBD"} vs {away?.name ?? "TBD"}
      </h1>
      <p className="text-sm text-[var(--muted)]">
        Current status: <span className="font-mono">{match.status}</span> · Score{" "}
        <span className="font-mono">
          {match.home_score ?? "–"} – {match.away_score ?? "–"}
        </span>
      </p>
      <OverrideForm
        matchId={match.id}
        homeScore={match.home_score ?? 0}
        awayScore={match.away_score ?? 0}
      />
    </div>
  );
}
