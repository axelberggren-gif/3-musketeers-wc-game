import { supabaseService } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import {
  FootballDataClient,
  deriveBracketSlot,
  mapStage,
  mapStatus,
  mapWinner,
  type FdMatch,
} from "./client";

const SOURCE = "football-data.org";

// football-data v4 returns `group` as "GROUP_A".."GROUP_L" (matching the
// uppercase/underscore convention of the `stage` enum). Older docs / v2 used
// "Group A".."Group L". Accept both; reject anything that doesn't end in A-L.
function parseGroupLetter(g: string | null): string | null {
  const m = g?.match(/([A-L])$/i);
  return m ? m[1].toUpperCase() : null;
}

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
    payload: (payload ?? null) as Json | null,
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
        group_letter: parseGroupLetter(m.group),
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
    // Propagate group_letter from matches to teams (nothing else writes it).
    try {
      await supabase.rpc("backfill_team_group_letters");
    } catch {}

    // Per-group / first-eliminated props are settled progressively as the
    // group stage unfolds; cheap when there's nothing new.
    try {
      await supabase.rpc("settle_group_stage_props");
    } catch {}

    // Drain per-match detail fetches for FINISHED matches that haven't been
    // synced yet. Capped per run to stay under the 10 req/min free-tier cap
    // (syncFixtures itself already burned 1, so 5 leaves a 4-call buffer).
    const detailsSynced = await drainPendingMatchDetails(supabase, fd, 5);

    try {
      await supabase.rpc("refresh_league_standings");
    } catch {}

    await log(supabase, "/matches", `Synced ${inserted} matches, scored ${scored} picks`, {
      inserted,
      scored,
      finished: finishedIds.length,
      detailsSynced,
    });

    return { inserted, scored, finished: finishedIds.length, detailsSynced };
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

// Fetches per-match bookings and goals for up to `limit` FINISHED matches
// where details_synced_at IS NULL, then writes player_card_log /
// player_goal_log rows and marks the match as synced. Returns the number of
// matches successfully drained. Errors on individual matches are logged but
// don't abort the run.
async function drainPendingMatchDetails(
  supabase: ReturnType<typeof supabaseService>,
  fd: FootballDataClient,
  limit: number,
): Promise<number> {
  const { data: pending } = await supabase
    .from("matches")
    .select("id, external_id")
    .eq("status", "FINISHED")
    .is("details_synced_at", null)
    .order("finished_at", { ascending: true })
    .limit(limit);

  if (!pending || pending.length === 0) return 0;

  const { data: allPlayers } = await supabase.from("players").select("id, external_id");
  const playerByExternal = new Map<number, string>();
  for (const p of allPlayers ?? []) {
    if (p.external_id != null) playerByExternal.set(p.external_id, p.id);
  }

  let synced = 0;
  for (const row of pending) {
    if (row.external_id == null) continue;
    try {
      const match = await fd.match(row.external_id);
      const goals = match.goals ?? [];
      const bookings = match.bookings ?? [];

      if (goals.length > 0) {
        const goalRows = goals
          .map((g) => {
            const pid = playerByExternal.get(g.scorer.id);
            if (!pid) return null;
            return { player_id: pid, match_id: row.id, minute: g.minute };
          })
          .filter((r): r is { player_id: string; match_id: string; minute: number | null } => r != null);
        if (goalRows.length > 0) {
          await supabase.from("player_goal_log").upsert(goalRows, {
            onConflict: "player_id,match_id,minute",
          });
        }
      }

      if (bookings.length > 0) {
        type CardRow = {
          player_id: string;
          match_id: string;
          minute: number | null;
          card_type: "YELLOW" | "RED" | "YELLOW_RED";
        };
        const cardRows: CardRow[] = [];
        for (const b of bookings) {
          const pid = playerByExternal.get(b.player.id);
          if (!pid) continue;
          cardRows.push({
            player_id: pid,
            match_id: row.id,
            minute: b.minute,
            card_type: b.card,
          });
        }
        if (cardRows.length > 0) {
          await supabase.from("player_card_log").upsert(cardRows, {
            onConflict: "player_id,match_id,minute,card_type",
          });
        }
      }

      if (match.bookings === undefined) {
        await log(
          supabase,
          `/matches/${row.external_id}`,
          "No bookings field in match payload — troublemaker prop will score nobody if every payload behaves this way (free-tier limitation?).",
        );
      }

      await supabase
        .from("matches")
        .update({ details_synced_at: new Date().toISOString() })
        .eq("id", row.id);
      synced++;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await log(supabase, `/matches/${row.external_id}`, `Detail sync failed: ${err}`);
    }
  }
  return synced;
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
