import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { BracketBuilder, type BracketSlot, type BracketTeam } from "@/components/predict/BracketBuilder";
import { CountdownBanner } from "@/components/predict/CountdownBanner";

export default async function BracketPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [tournamentRes, teamsRes, picksRes] = await Promise.all([
    supabase.from("tournament").select("*").single(),
    supabase
      .from("teams")
      .select("id, name, short_name, code, crest_url")
      .order("name"),
    supabase.from("bracket_predictions").select("bracket_slot, team_id").eq("user_id", user.id),
  ]);

  const tournament = tournamentRes.data;
  const locks = computeLockState(tournament);
  const teams = (teamsRes.data ?? []) as BracketTeam[];
  const initial = Object.fromEntries(
    (picksRes.data ?? []).map((r) => [r.bracket_slot as string, r.team_id as string]),
  ) as Record<string, string | null>;

  const slots = buildSlotDefs(teams);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <span
          className="badge badge-coral self-start -rotate-2"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          Round 2 · Knockouts
        </span>
        <h1 className="font-display uppercase text-4xl sm:text-5xl leading-none tracking-tight">
          Knockout <span className="text-coral">bracket</span>
        </h1>
        <p className="text-sm text-ink-soft">
          Fill in your bracket from R16 to the Final, plus your overall champion. Locks at the
          start of R16.
        </p>
      </header>

      {tournament && (
        <CountdownBanner
          target={tournament.knockout_start_at}
          label="Bracket locks in"
        />
      )}

      <BracketBuilder slots={slots} initial={initial} locked={locks.round2Locked} />
    </main>
  );
}

function buildSlotDefs(teams: BracketTeam[]): BracketSlot[] {
  const slots: BracketSlot[] = [];
  for (let i = 1; i <= 8; i++) {
    slots.push({ slot: `R16-${i}`, label: `R16 match ${i}`, stage: "R16", options: teams });
  }
  for (const c of ["A", "B", "C", "D"]) {
    slots.push({ slot: `QF-${c}`, label: `QF ${c}`, stage: "QF", options: teams });
  }
  for (const c of ["A", "B"]) {
    slots.push({ slot: `SF-${c}`, label: `SF ${c}`, stage: "SF", options: teams });
  }
  slots.push({ slot: "F", label: "Final", stage: "F", options: teams });
  slots.push({ slot: "W", label: "Champion", stage: "W", options: teams });
  return slots;
}
