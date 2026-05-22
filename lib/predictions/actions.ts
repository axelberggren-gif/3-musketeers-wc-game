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
  first_eliminated_team_id?: string | null;
  total_goals_guess?: number | null;
  highest_match_goals_guess?: number | null;
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

export async function setTotalGoalsGuess(value: number | null) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 300)) {
    return { ok: false, error: "Pick an integer between 0 and 300." } as const;
  }
  return setTournamentPick({ total_goals_guess: value });
}

export async function setHighestMatchGoalsGuess(value: number | null) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 30)) {
    return { ok: false, error: "Pick an integer between 0 and 30." } as const;
  }
  return setTournamentPick({ highest_match_goals_guess: value });
}

export async function setFirstEliminatedPick(teamId: string | null) {
  return setTournamentPick({ first_eliminated_team_id: teamId });
}

export async function setGroupWinnerPick(groupLetter: string, teamId: string | null) {
  if (!/^[A-L]$/.test(groupLetter)) {
    return { ok: false, error: "Invalid group letter." } as const;
  }
  const { supabase, user } = await authedClient();
  const locks = await getLocks();
  if (locks.round1Locked) return { ok: false, error: "Round 1 picks are locked." } as const;
  if (teamId == null) {
    const { error } = await supabase
      .from("group_winner_predictions")
      .delete()
      .eq("user_id", user.id)
      .eq("group_letter", groupLetter);
    if (error) return { ok: false, error: error.message } as const;
  } else {
    const { error } = await supabase
      .from("group_winner_predictions")
      .upsert(
        { user_id: user.id, group_letter: groupLetter, team_id: teamId },
        { onConflict: "user_id,group_letter" },
      );
    if (error) return { ok: false, error: error.message } as const;
  }
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
