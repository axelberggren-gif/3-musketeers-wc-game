"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import type { Pick1X2 } from "@/lib/supabase/types";

async function authedClient() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, user };
}

async function getLocks() {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("tournament").select("*").single();
  return computeLockState(data);
}

export async function setMatchPick(matchId: string, pick: Pick1X2) {
  const { supabase, user } = await authedClient();
  const locks = await getLocks();
  if (locks.round1Locked) {
    return { ok: false, error: "Round 1 picks are locked." } as const;
  }
  const { error } = await supabase
    .from("match_predictions")
    .upsert({ user_id: user.id, match_id: matchId, pick }, { onConflict: "user_id,match_id" });
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath("/predict");
  return { ok: true } as const;
}

export async function setTournamentPick(values: {
  winner_team_id?: string | null;
  runner_up_team_id?: string | null;
  top_scorer_player_id?: string | null;
  dark_horse_team_id?: string | null;
}) {
  const { supabase, user } = await authedClient();
  const locks = await getLocks();
  if (locks.round1Locked) return { ok: false, error: "Round 1 picks are locked." } as const;
  const { error } = await supabase
    .from("tournament_predictions")
    .upsert({ user_id: user.id, ...values }, { onConflict: "user_id" });
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath("/predict");
  return { ok: true } as const;
}

export async function setPlayerProp(propKey: string, playerId: string) {
  const { supabase, user } = await authedClient();
  const locks = await getLocks();
  if (locks.round1Locked) return { ok: false, error: "Round 1 picks are locked." } as const;
  const { error } = await supabase
    .from("player_prop_predictions")
    .upsert({ user_id: user.id, prop_key: propKey, player_id: playerId }, {
      onConflict: "user_id,prop_key",
    });
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath("/predict");
  return { ok: true } as const;
}

export async function setBracketPick(slot: string, teamId: string) {
  const { supabase, user } = await authedClient();
  const locks = await getLocks();
  if (locks.round2Locked) return { ok: false, error: "Round 2 bracket is locked." } as const;
  const { error } = await supabase
    .from("bracket_predictions")
    .upsert({ user_id: user.id, bracket_slot: slot, team_id: teamId }, {
      onConflict: "user_id,bracket_slot",
    });
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath("/predict/bracket");
  return { ok: true } as const;
}
