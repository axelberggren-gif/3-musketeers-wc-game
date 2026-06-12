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

  const picksRes =
    distinct.length > 0
      ? await supabase
          .from("match_predictions")
          .select("id, user_id, match_id, pick")
          .in("user_id", distinct)
      : { data: [] };

  const matches = (matchesRes.data ?? []) as unknown as GroupPickMatch[];
  const groupMatchIds = new Set(matches.map((m) => m.id));

  const picksByUser: Record<string, Record<string, VisiblePick>> = {};
  for (const id of distinct) picksByUser[id] = {};
  for (const row of picksRes.data ?? []) {
    if (!groupMatchIds.has(row.match_id)) continue;
    (picksByUser[row.user_id] ??= {})[row.match_id] = {
      pickId: row.id,
      pick: row.pick as Pick1X2,
    };
  }

  return { matches, picksByUser };
}
