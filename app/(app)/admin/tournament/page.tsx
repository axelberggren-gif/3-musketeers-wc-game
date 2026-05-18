import { supabaseServer } from "@/lib/supabase/server";
import { TournamentForm } from "./TournamentForm";

export default async function AdminTournamentPage() {
  const supabase = await supabaseServer();
  const { data: tournament } = await supabase.from("tournament").select("*").single();
  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <h1 className="text-2xl font-bold">Tournament dates</h1>
      <p className="text-sm text-[var(--muted)]">
        Round 1 picks lock at first kickoff. Bracket picks lock at knockout start. Set both in UTC
        (the form takes a datetime-local value and stores ISO).
      </p>
      <TournamentForm
        first={tournament?.first_kickoff_at ?? ""}
        ko={tournament?.knockout_start_at ?? ""}
        final={tournament?.final_at ?? ""}
      />
    </div>
  );
}
