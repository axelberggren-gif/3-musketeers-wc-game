import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import {
  BracketBuilder,
  type BracketMatchPair,
  type BracketSlot,
  type BracketStage,
  type BracketTeam,
} from "@/components/predict/BracketBuilder";
import { CountdownBanner } from "@/components/predict/CountdownBanner";
import {
  filterSuggestionsByMatchPairs,
  predictedGroupStandings,
  suggestR32Qualifiers,
  type GroupMatch,
} from "@/lib/scoring/bracket-tree";
import type { Pick1X2 } from "@/lib/supabase/types";

const KNOCKOUT_STAGES = ["R32", "R16", "QF", "SF", "F"] as const;

export default async function BracketPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [
    tournamentRes,
    teamsRes,
    picksRes,
    groupMatchesRes,
    groupPicksRes,
    knockoutMatchesRes,
  ] = await Promise.all([
    supabase.from("tournament").select("*").single(),
    supabase
      .from("teams")
      .select("id, name, short_name, code, crest_url")
      .order("name"),
    supabase.from("bracket_predictions").select("bracket_slot, team_id").eq("user_id", user.id),
    supabase
      .from("matches")
      .select("id, group_letter, home_team_id, away_team_id")
      .eq("stage", "GROUP"),
    supabase.from("match_predictions").select("match_id, pick").eq("user_id", user.id),
    supabase
      .from("matches")
      .select("bracket_slot, home_team_id, away_team_id")
      .in("stage", KNOCKOUT_STAGES),
  ]);

  const tournament = tournamentRes.data;
  const locks = computeLockState(tournament);
  const teams = (teamsRes.data ?? []) as BracketTeam[];
  const initial = Object.fromEntries(
    (picksRes.data ?? []).map((r) => [r.bracket_slot as string, r.team_id as string]),
  ) as Record<string, string | null>;

  const groupMatches = (groupMatchesRes.data ?? []) as GroupMatch[];
  const picksByMatchId = Object.fromEntries(
    (groupPicksRes.data ?? []).map((r) => [r.match_id as string, r.pick as Pick1X2]),
  );
  const standings = predictedGroupStandings(groupMatches, picksByMatchId);
  const teamNameById = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const r32Suggestions = suggestR32Qualifiers(standings, teamNameById);

  // Real knockout matches (once football-data lands them via syncFixtures()).
  // Only slots with BOTH team_ids set are usable — R16/QF/etc may exist as
  // placeholder rows before R32 is played out, with NULL home/away. Those fall
  // through to the dropdown fallback in BracketBuilder.
  const slotMatches: Record<string, BracketMatchPair> = {};
  for (const m of knockoutMatchesRes.data ?? []) {
    if (m.bracket_slot && m.home_team_id && m.away_team_id) {
      slotMatches[m.bracket_slot] = {
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
      };
    }
  }

  const compatibleSuggestions = filterSuggestionsByMatchPairs(r32Suggestions, slotMatches);

  const slots = buildSlotDefs();

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
          Fill in your bracket from the Round of 32 through the Final, plus your overall champion.
          Once the real matches drop you pick a winner per match; until then each slot reveals from
          your upstream picks. Locks at the start of R32.
        </p>
      </header>

      {tournament && (
        <CountdownBanner
          target={tournament.knockout_start_at}
          label="Bracket locks in"
        />
      )}

      <BracketBuilder
        slots={slots}
        teams={teams}
        initial={initial}
        locked={locks.round2Locked}
        r32Suggestions={compatibleSuggestions}
        slotMatches={slotMatches}
      />
    </main>
  );
}

function buildSlotDefs(): BracketSlot[] {
  const slots: BracketSlot[] = [];
  for (let i = 1; i <= 16; i++) {
    slots.push({ slot: `R32-${i}`, label: `R32 match ${i}`, stage: "R32" as BracketStage });
  }
  for (let i = 1; i <= 8; i++) {
    slots.push({ slot: `R16-${i}`, label: `R16 match ${i}`, stage: "R16" as BracketStage });
  }
  for (const c of ["A", "B", "C", "D"]) {
    slots.push({ slot: `QF-${c}`, label: `QF ${c}`, stage: "QF" as BracketStage });
  }
  for (const c of ["A", "B"]) {
    slots.push({ slot: `SF-${c}`, label: `SF ${c}`, stage: "SF" as BracketStage });
  }
  slots.push({ slot: "F", label: "Final", stage: "F" as BracketStage });
  slots.push({ slot: "W", label: "Champion", stage: "W" as BracketStage });
  return slots;
}
