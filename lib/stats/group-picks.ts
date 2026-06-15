import { supabaseServer } from "@/lib/supabase/server";
import type { Pick1X2 } from "@/lib/supabase/types";
import type { GroupPickMatch, GroupStagePicks, VisiblePick } from "./picks-shared";

// The pure types + helpers (pickOutcome, tallyPickRecord, groupMatchesByLetter, …)
// live in the IO-free `picks-shared.ts` so client components can import them;
// re-exported here so existing server-side imports keep working unchanged.
export * from "./picks-shared";

// ─── IO loader ───────────────────────────────────────────────────────────────
/**
 * Loads the group-stage board for one or more users: every GROUP match plus each
 * user's 1X2 pick per match. RLS-aware — runs as the viewer, so another user's
 * picks only appear once `mp_read_after_lock` (migration 0026) grants them
 * (league-mates, after round-1 lock). Absent rows are indistinguishable from
 * hidden ones; callers gate their empty states on visible-pick counts.
 */
export async function loadGroupStagePicks(userIds: string[]): Promise<GroupStagePicks> {
  const supabase = await supabaseServer();
  const distinct = [...new Set(userIds)];

  const matchesRes = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, group_letter, status, home_score, away_score, winner, home:teams!home_team_id(name, code, crest_url), away:teams!away_team_id(name, code, crest_url)",
    )
    .eq("stage", "GROUP")
    .order("kickoff_at", { ascending: true });

  // A big league (~40 members) × up to 48 group matches can push the picks well
  // past PostgREST's default 1000-row page cap. A single unpaginated select
  // silently truncates the result in arbitrary physical-row order, so members
  // whose rows fall past the cap render as "No pick" even though they've picked.
  // Range-paginate (ordered by a stable key) to fetch every visible pick — same
  // fix as `fetchAllPlayers` in app/(app)/predict/outcomes/page.tsx.
  type PickRow = { id: string; user_id: string; match_id: string; pick: Pick1X2 };
  const pickRows: PickRow[] = [];
  if (distinct.length > 0) {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data } = await supabase
        .from("match_predictions")
        .select("id, user_id, match_id, pick")
        .in("user_id", distinct)
        .order("id")
        .range(from, from + pageSize - 1);
      pickRows.push(...((data ?? []) as unknown as PickRow[]));
      if (!data || data.length < pageSize) break;
    }
  }

  const matches = (matchesRes.data ?? []) as unknown as GroupPickMatch[];
  const groupMatchIds = new Set(matches.map((m) => m.id));

  const picksByUser: Record<string, Record<string, VisiblePick>> = {};
  for (const id of distinct) picksByUser[id] = {};
  for (const row of pickRows) {
    if (!groupMatchIds.has(row.match_id)) continue;
    (picksByUser[row.user_id] ??= {})[row.match_id] = {
      pickId: row.id,
      pick: row.pick as Pick1X2,
    };
  }

  return { matches, picksByUser };
}
