import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { isRound2Exempt } from "@/lib/predictions/round2-access";
import {
  BracketBuilder,
  type BracketMatchPair,
  type BracketSlot,
  type BracketStage,
  type BracketTeam,
  type SlotResult,
} from "@/components/predict/BracketBuilder";
import { CountdownBanner } from "@/components/predict/CountdownBanner";

const KNOCKOUT_STAGES = ["R32", "R16", "QF", "SF", "F"] as const;

export default async function BracketPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [tournamentRes, teamsRes, picksRes, knockoutMatchesRes] =
    await Promise.all([
      supabase.from("tournament").select("*").single(),
      supabase
        .from("teams")
        .select("id, name, short_name, code, crest_url")
        .order("name"),
      supabase.from("bracket_predictions").select("bracket_slot, team_id").eq("user_id", user.id),
      supabase
        .from("matches")
        .select("bracket_slot, home_team_id, away_team_id, status, winner, home_score, away_score")
        .in("stage", KNOCKOUT_STAGES),
    ]);

  const tournament = tournamentRes.data;
  // Per-league bracket exemption (migration 0032): a member of a league listed in
  // tournament.locked_overrides.round2_open_leagues keeps the bracket editable
  // past the global knockout lock. `knockoutStarted` is the *global* lock state —
  // used to hide the "locks in" countdown for exempt users (the target is past).
  const round2Exempt = await isRound2Exempt(tournament, user.id);
  const knockoutStarted = tournament
    ? new Date() >= new Date(tournament.knockout_start_at)
    : false;
  const locks = computeLockState(tournament, undefined, { round2Exempt });
  const teams = (teamsRes.data ?? []) as BracketTeam[];
  const initial = Object.fromEntries(
    (picksRes.data ?? []).map((r) => [r.bracket_slot as string, r.team_id as string]),
  ) as Record<string, string | null>;

  // Real knockout matches (once football-data lands them via syncFixtures()).
  // `slotMatches` feeds the R32 entry cells their real pairing; `results` feeds
  // the live-scored mode (winner + scoreline + status) per slot. football-data
  // resolves the two sides of an R32 fixture independently as groups finish, so
  // we record a slot as soon as *either* side has a team — the bracket fills each
  // side from the real fixture and shows a placeholder for the side still NULL.
  // (Placeholder R16+ rows with no teams simply contribute nothing.)
  const slotMatches: Record<string, BracketMatchPair> = {};
  const results: Record<string, SlotResult> = {};
  for (const m of knockoutMatchesRes.data ?? []) {
    if (!m.bracket_slot) continue;
    if (m.home_team_id || m.away_team_id) {
      slotMatches[m.bracket_slot] = {
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
      };
    }
    const winnerTeamId =
      m.winner === "HOME" ? m.home_team_id : m.winner === "AWAY" ? m.away_team_id : null;
    results[m.bracket_slot] = {
      winnerTeamId,
      homeScore: m.home_score,
      awayScore: m.away_score,
      status: m.status,
    };
  }
  // The champion (`W`) is scored off the Final match.
  if (results["F"]) results["W"] = results["F"];

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
          The <span className="text-coral">wall chart</span>
        </h1>
        <p className="text-sm text-ink-soft">
          Fill your knockout bracket end to end — Round of 32 through the Final, then crown your
          champion. Each R32 tie fills in from the group stage (Winner / Runner-up / 3rd of each
          group) as those groups finish; pick a winner per match and they flow into the next round.
          Slots you haven&rsquo;t reached yet read &ldquo;Winner of …&rdquo; until their feeder is
          decided. Locks at the start of R32, then scores itself live as results land.
        </p>
      </header>

      {tournament && !knockoutStarted && (
        <CountdownBanner target={tournament.knockout_start_at} label="Bracket locks in" />
      )}

      {round2Exempt && knockoutStarted && (
        <p
          className="badge badge-gold self-start"
          style={{ boxShadow: "3px 3px 0 var(--ink)" }}
        >
          ⏳ Your league has extended bracket access — matches already played still
          score against the real result.
        </p>
      )}

      <BracketBuilder
        slots={slots}
        teams={teams}
        initial={initial}
        locked={locks.round2Locked}
        slotMatches={slotMatches}
        results={results}
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
