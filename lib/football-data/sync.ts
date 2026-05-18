import { supabaseService } from "@/lib/supabase/server";
import { FootballDataClient, mapStage, mapStatus, mapWinner } from "./client";

const SOURCE = "football-data.org";

async function log(supabase: ReturnType<typeof supabaseService>, endpoint: string, message: string, payload?: unknown, status_code?: number) {
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
      await supabase.from("teams").upsert(
        {
          external_id: t.id,
          name: t.name,
          short_name: t.shortName ?? t.name,
          code: t.tla ?? t.name.slice(0, 3).toUpperCase(),
          crest_url: t.crest,
        },
        { onConflict: "external_id" },
      );
      if (t.squad?.length) {
        const rows = t.squad.map((p) => ({
          external_id: p.id,
          name: p.name,
          position: p.position,
        }));
        // First upsert player base, then patch team_id (need the local team uuid)
        await supabase.from("players").upsert(rows, { onConflict: "external_id" });
        const { data: localTeam } = await supabase
          .from("teams")
          .select("id")
          .eq("external_id", t.id)
          .single();
        if (localTeam) {
          await supabase
            .from("players")
            .update({ team_id: localTeam.id })
            .in(
              "external_id",
              t.squad.map((p) => p.id),
            );
        }
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
    let inserted = 0;
    let scored = 0;
    const finishedIds: string[] = [];
    let hadKnockout = false;

    for (const m of matches) {
      const homeUuid = m.homeTeam.id ? await teamUuidByExternal(supabase, m.homeTeam.id) : null;
      const awayUuid = m.awayTeam.id ? await teamUuidByExternal(supabase, m.awayTeam.id) : null;

      const localStage = mapStage(m.stage);
      const isKnockout = localStage !== "GROUP";

      const payload = {
        external_id: m.id,
        stage: localStage,
        group_letter: m.group ? m.group.replace("Group ", "").slice(0, 1) : null,
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
      }
      if (isKnockout) hadKnockout = true;
      inserted++;
    }

    // Score newly finished matches
    for (const id of finishedIds) {
      const { data, error } = await supabase.rpc("score_match", { p_match_id: id });
      if (!error && typeof data === "number") scored += data;
    }
    if (hadKnockout) {
      await supabase.rpc("score_bracket");
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

async function teamUuidByExternal(
  supabase: ReturnType<typeof supabaseService>,
  external_id: number,
) {
  const { data } = await supabase
    .from("teams")
    .select("id")
    .eq("external_id", external_id)
    .maybeSingle();
  return data?.id ?? null;
}
