import { supabaseServer } from "@/lib/supabase/server";
import type { Tournament } from "@/lib/supabase/types";

/**
 * League ids granted post-knockout bracket access, read from
 * `tournament.locked_overrides.round2_open_leagues` (a jsonb array of uuid
 * strings; see migration 0032). Tolerant of the column being `{}`, missing the
 * key, or holding a non-array — returns `[]` in all of those cases.
 */
export function round2OpenLeagueIds(tournament: Tournament | null): string[] {
  const overrides = tournament?.locked_overrides;
  if (overrides == null || typeof overrides !== "object" || Array.isArray(overrides)) {
    return [];
  }
  const ids = (overrides as { round2_open_leagues?: unknown }).round2_open_leagues;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/**
 * True when `userId` belongs to at least one league granted post-knockout
 * bracket access. Mirrors the SQL `round2_locked_for()` exemption so the bracket
 * page UI and the `setBracketPick*` server actions agree with the DB trigger.
 *
 * RLS-safe: a user can always read their own `league_members` rows
 * (`league_members_read_self_leagues`), and we only ever query for the acting
 * user — no service-role, no cross-user read.
 */
export async function isRound2Exempt(
  tournament: Tournament | null,
  userId: string,
): Promise<boolean> {
  const openLeagues = round2OpenLeagueIds(tournament);
  if (openLeagues.length === 0) return false;
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("league_members")
    .select("league_id")
    .eq("user_id", userId)
    .in("league_id", openLeagues);
  return (data?.length ?? 0) > 0;
}
