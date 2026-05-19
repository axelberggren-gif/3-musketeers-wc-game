import { supabaseService } from "@/lib/supabase/server";
import {
  FootballDataClient,
  deriveBracketSlot,
  mapStage,
  mapStatus,
  mapWinner,
  type FdMatch,
} from "./client";

const SOURCE = "football-data.org";

async function log(
  supabase: ReturnType<typeof supabaseService>,
  endpoint: string,
  message: string,
  payload?: unknown,
  status_code?: number,
) {
  await supabase.from("external_sync_log").insert({
    source: SOURCE,
    endpoint,
    status_code: status_code ?? null,
    message,
    payload: (payload as object) ?? null,
  });
}

export async function seedTeams() {
  const supabase = supabaseService();
  const fd = new FootballDataClient();
  try {
    const { teams } = await fd.teams();
    for (const t of teams) {
      const { data: localTeam } = await supabase
        .from("teams")
        .upsert(
          {
            external_id: t.id,
            name: t.name,
            short_name: t.shortName ?? t.name,
            code: t.tla ?? t.name.slice(0, 3).toUpperCase(),
            crest_url: t.crest,
          },
          { onConflict: "external_id" },
        )
        .select("id")
        .single();

      if (t.squad?.length && localTeam) {
        await supabase.from("players").upsert(
          t.squad.map((p) => ({
            external_id: p.id,
            name: p.name,
            position: p.position,
            team_id: localTeam.id,
          })),
          { onConflict: "external_id" },
        );
      }
    }
    await log(supabase, "/teams", `Seeded ${teams.length} teams`, { count: teams.length });
    return { teams: teams.length };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await log(supabase, "/teams", `Failed: ${err}`);
    throw e;
  }
}

export async function syncFixtures() {
  const supabase = supabaseService();
  const fd = new FootballDataClient();
  try {
    const { matches } = await fd.matches();

    const { data: allTeams } = await supabase.from("teams").select("id, external_id");
    const teamByExternal = new Map<number, string>();
    for (const t of allTeams ?? []) {
      if (t.external_id != null) teamByExternal.set(t.external_id, t.id);
    }

    const bracketSlotByExternalId = buildBracketSlotMap(matches);

    let inserted = 0;
    let scored = 0;
    const finishedIds: string[] = [];
    let hadKnockout = false;
    let finalFinished = false;

    for (const m of matches) {
      const homeUuid = m.homeTeam.id ? teamByExternal.get(m.homeTeam.id) ?? null : null;
      const awayUuid = m.awayTeam.id ? teamByExternal.get(m.awayTeam.id) ?? null : null;

      const localStage = mapStage(m.stage);
      const isKnockout = localStage !== "GROUP";
      const bracketSlot = bracketSlotByExternalId.get(m.id) ?? null;

      const payload = {
        external_id: m.id,
        stage: localStage,
        group_letter: m.group ? m.group.replace("Group ", "").slice(0, 1) : null,
        bracket_slot: bracketSlot,
        kickoff_at: m.utcDate,
        home_team_id: homeUuid,
        away_team_id: awayUuid,
        status: mapStatus(m.status),
        home_score: m.score.fullTime.home,
        away_score: m.score.fullTime.away,
        winner: mapWinner(m.score.winner),
        finished_at: m.status === "FINISHED" ? new Date().toISOString() : null,
      };

      const { data: upserted } = await supabase
        .from("matches")
        .upsert(payload, { onConflict: "external_id" })
        .select("id, status")
        .single();

      if (upserted && payload.status === "FINISHED" && payload.winner) {
        finishedIds.push(upserted.id);
        if (bracketSlot === "F") finalFinished = true;
      }
      if (isKnockout) hadKnockout = true;
      inserted++;
    }

    for (const id of finishedIds) {
      const { data, error } = await supabase.rpc("score_match", { p_match_id: id });
      if (!error && typeof data === "number") scored += data;
    }
    if (hadKnockout) {
      await supabase.rpc("score_bracket");
    }
    if (finalFinished) {
      await supabase.rpc("score_tournament");
    }
    try {
      await supabase.rpc("refresh_league_standings");
    } catch {}

    await log(supabase, "/matches", `Synced ${inserted} matches, scored ${scored} picks`, {
      inserted,
      scored,
      finished: finishedIds.length,
    });

    return { inserted, scored, finished: finishedIds.length };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await log(supabase, "/matches", `Failed: ${err}`);
    throw e;
  }
}

export async function syncScorers() {
  const supabase = supabaseService();
  const fd = new FootballDataClient();
  try {
    const { scorers } = await fd.scorers(50);
    // Goals are recorded individually via match goals where available;
    // scorers endpoint gives cumulative totals. We treat it as informational.
    await log(supabase, "/scorers", `Fetched ${scorers.length} scorers`, { count: scorers.length });
    return { scorers: scorers.length };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await log(supabase, "/scorers", `Failed: ${err}`);
    throw e;
  }
}

// Assign bracket_slot deterministically per knockout stage by kickoff order.
// FIFA's schedule is fixed once the draw is set, so the first R16 match by
// kickoff is always R16-1, the first QF is QF-A, etc.
function buildBracketSlotMap(matches: FdMatch[]): Map<number, string> {
  const byStage = new Map<string, FdMatch[]>();
  for (const m of matches) {
    const stage = mapStage(m.stage);
    if (stage === "GROUP") continue;
    const arr = byStage.get(stage) ?? [];
    arr.push(m);
    byStage.set(stage, arr);
  }
  const result = new Map<number, string>();
  for (const [stage, group] of byStage.entries()) {
    group.sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    group.forEach((m, idx) => {
      const slot = deriveBracketSlot(stage as ReturnType<typeof mapStage>, idx);
      if (slot) result.set(m.id, slot);
    });
  }
  return result;
}
