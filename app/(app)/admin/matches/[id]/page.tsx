import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { OverrideForm } from "./OverrideForm";

type TeamName = { name: string };

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
      "id, status, home_score, away_score, home:teams!home_team_id(name), away:teams!away_team_id(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!match) notFound();
  const home = match.home as TeamName | null;
  const away = match.away as TeamName | null;

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
