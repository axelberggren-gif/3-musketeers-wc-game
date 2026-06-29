import { supabaseService } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import {
  FootballDataClient,
  mapStage,
  mapStatus,
  resolveWinner,
  type FdMatch,
} from "./client";
import { knockoutSlotByFeeders, r32SlotForMatchup } from "@/lib/scoring/bracket-tree";

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
    // Seed fifa_ranking for the freshly-upserted teams (migration 0029). The
    // football-data payload has no ranks and 0005's one-shot UPDATE block ran
    // before any team rows existed on a fresh deploy, so without this the
    // column stays NULL and dark-horse scoring pays nobody. Idempotent, no
    // football-data API cost; best-effort like the other backfill RPCs.
    try {
      await supabase.rpc("backfill_team_fifa_rankings");
    } catch {
      // Best-effort: idempotent RPC, the next cron run retries.
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
        winner: resolveWinner(m),
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
    } catch {
      // Best-effort: idempotent RPC, the next cron run retries.
    }

    // Self-heal teams.fifa_ranking (migration 0029) — teams seeded after
    // 0005's one-shot UPDATE block would otherwise stay NULL and dark-horse
    // scoring would pay nobody. Idempotent, zero football-data API cost.
    try {
      await supabase.rpc("backfill_team_fifa_rankings");
    } catch {
      // Best-effort: idempotent RPC, the next cron run retries.
    }

    // Per-group / first-eliminated props are settled progressively as the
    // group stage unfolds; cheap when there's nothing new.
    try {
      await supabase.rpc("settle_group_stage_props");
    } catch {
      // Best-effort: idempotent RPC, the next cron run retries.
    }

    // Drain per-match detail fetches for FINISHED matches that haven't been
    // synced yet. Capped per run to stay under the 10 req/min free-tier cap
    // (syncFixtures itself already burned 1, so 5 leaves a 4-call buffer).
    const detailsSynced = await drainPendingMatchDetails(supabase, fd, 5);

    try {
      await supabase.rpc("refresh_league_standings");
    } catch {
      // Best-effort: idempotent RPC, the next cron run retries.
    }

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

// Daily catch-up cron. The 10-min syncFixtures() drain is capped at 5 matches
// per run; this is the backstop that clears any remaining backlog of FINISHED
// matches whose goals/cards haven't been drained yet, then reconciles
// tournament scoring so the drain-gated top-scorer / troublemaker categories
// settle on complete data (see #83). It used to just fetch the /scorers list
// and log it — that fed no scoring table and was a footgun during incidents.
//
// Rate budget: this run spends NO request on the list endpoint, so its full
// 10 req/min budget is available for detail fetches. Capped at
// SCORERS_DRAIN_LIMIT (8) to stay comfortably under the limit.
const SCORERS_DRAIN_LIMIT = 8;

export async function syncScorers() {
  const supabase = supabaseService();
  const fd = new FootballDataClient();
  try {
    const detailsSynced = await drainPendingMatchDetails(supabase, fd, SCORERS_DRAIN_LIMIT);

    // No-op until the Final is FINISHED and the drain is complete (the gated
    // sub-scorers short-circuit); cheap otherwise.
    let scored = 0;
    const { data } = await supabase.rpc("score_tournament");
    if (typeof data === "number") scored = data;
    try {
      await supabase.rpc("refresh_league_standings");
    } catch {
      // Best-effort: idempotent RPC, the next cron run retries.
    }

    await log(
      supabase,
      "/scorers",
      `Drained ${detailsSynced} match details, tournament awarded ${scored}`,
      { detailsSynced, scored },
    );
    return { detailsSynced, scored };
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

// Assign bracket_slot to each knockout match by FIFA bracket position — NOT by
// kickoff order. football-data schedules the R32 (and, tightly, the R16)
// kickoffs in an order that does not match FIFA's bracket numbering, and match
// `external_id` order isn't FIFA order either, so a kickoff/id sort mis-pairs
// teams (e.g. France and Morocco landing in the same Round of 16). Instead:
//   * R32 — pinned to its FIFA slot by the realised matchup (R32_MATCHUP_SLOT).
//   * R16/QF/SF — derived from lineage: each match is the slot whose two feeder
//     slots' winners are its two contestants (knockoutSlotByFeeders). Resolvable
//     only once the feeder matches are FINISHED with a winner; until then the
//     match is left unslotted (its slot isn't needed until it's scored, and the
//     builder draws the tree from BRACKET_UPSTREAM, not these rows).
//   * F / 3RD — unique per stage, assigned directly.
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

  // Team external id → the slot whose match it won (built as we resolve rounds).
  const slotWonByTeam = new Map<number, string>();
  const winnerExternalId = (m: FdMatch): number | null => {
    const w = resolveWinner(m);
    if (w === "HOME") return m.homeTeam.id;
    if (w === "AWAY") return m.awayTeam.id;
    return null;
  };
  const assign = (m: FdMatch, slot: string) => {
    result.set(m.id, slot);
    const w = winnerExternalId(m);
    if (w != null) slotWonByTeam.set(w, slot);
  };

  // R32: canonical matchup → slot (kickoff/id order is not FIFA bracket order).
  for (const m of byStage.get("R32") ?? []) {
    const slot = r32SlotForMatchup(m.homeTeam.tla, m.awayTeam.tla);
    if (slot) assign(m, slot);
  }

  // R16 → QF → SF, in dependency order: slot each match from the feeder slots
  // its two contestants won. Skip until both feeders have resolved.
  for (const stage of ["R16", "QF", "SF"] as const) {
    for (const m of byStage.get(stage) ?? []) {
      const a = m.homeTeam.id != null ? slotWonByTeam.get(m.homeTeam.id) : undefined;
      const b = m.awayTeam.id != null ? slotWonByTeam.get(m.awayTeam.id) : undefined;
      if (!a || !b) continue;
      const slot = knockoutSlotByFeeders(a, b);
      if (slot) assign(m, slot);
    }
  }

  // Final + third-place play-off are the only match in their stage.
  for (const m of byStage.get("F") ?? []) result.set(m.id, "F");
  for (const m of byStage.get("3RD") ?? []) result.set(m.id, "3RD");

  return result;
}
