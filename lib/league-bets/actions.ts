"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import { isBetKind, type BetKind } from "./shared";

type Result = { ok: true } | { ok: false; error: string };

// Cast (or clear) one league-internal vote. The DB also enforces all of this —
// RLS limits writes to your own row in a league you + the votee belong to, and
// the enforce_round1_lock trigger rejects writes after first kickoff — so these
// checks are UX-side; the DB is the real gate. `revalidate` is the caller's
// current path (league page or /predict/outcomes) so its server render refreshes.
export async function setLeagueBet(
  leagueId: string,
  kind: BetKind,
  voteeId: string | null,
  revalidate?: string,
): Promise<Result> {
  if (!isBetKind(kind)) return { ok: false, error: "Invalid bet kind." };

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: tournament } = await supabase.from("tournament").select("*").single();
  if (computeLockState(tournament).round1Locked) {
    return { ok: false, error: "League bets are locked — the tournament has started." };
  }

  if (voteeId == null) {
    // Re-selecting your current pick clears it — delete the row so UI + DB agree.
    const { error } = await supabase
      .from("league_group_bets")
      .delete()
      .eq("league_id", leagueId)
      .eq("voter_id", user.id)
      .eq("bet_kind", kind);
    if (error) return { ok: false, error: error.message };
  } else if (voteeId === user.id) {
    return { ok: false, error: "Pick another member, not yourself." };
  } else {
    const { error } = await supabase.from("league_group_bets").upsert(
      { league_id: leagueId, voter_id: user.id, bet_kind: kind, votee_id: voteeId },
      { onConflict: "league_id,voter_id,bet_kind" },
    );
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/predict/outcomes");
  if (revalidate && revalidate !== "/predict/outcomes") revalidatePath(revalidate);
  return { ok: true };
}
