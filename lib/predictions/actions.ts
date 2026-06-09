"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { computeLockState } from "@/lib/scoring/lock";
import {
  PICK_REACTION_EMOJI,
  type PickKind,
  type PickReactionEmoji,
} from "@/lib/predictions/reactions-shared";
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

export async function setMatchPick(matchId: string, pick: Pick1X2 | null) {
  const { supabase, user } = await authedClient();
  const locks = await getLocks();
  if (locks.round1Locked) {
    return { ok: false, error: "Round 1 picks are locked." } as const;
  }
  if (pick == null) {
    // Re-tapping the selected tile clears the pick — delete the row so UI and
    // DB agree.
    const { error } = await supabase
      .from("match_predictions")
      .delete()
      .eq("user_id", user.id)
      .eq("match_id", matchId);
    if (error) return { ok: false, error: error.message } as const;
  } else {
    const { error } = await supabase
      .from("match_predictions")
      .upsert({ user_id: user.id, match_id: matchId, pick }, { onConflict: "user_id,match_id" });
    if (error) return { ok: false, error: error.message } as const;
  }
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
  final_goals_guess?: number | null;
  biggest_win_margin_guess?: number | null;
  golden_boot_goals_guess?: number | null;
  total_red_cards_guess?: number | null;
  // Admin-resolved "house special" props (migration 0022).
  neymar_minutes_pick?: boolean | null;
  streaker_pick?: boolean | null;
  best_goalkeeper_player_id?: string | null;
  golden_boot_team_id?: string | null;
  own_goals_guess?: number | null;
  war_game_match_id?: string | null;
  swedish_players_guess?: number | null;
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
  // No upper bound (migration 0025) — WC 2026's 104 matches can plausibly clear
  // the old 0..300 cap. Closest-guess scoring means a wild value just loses, so
  // we only enforce a non-negative integer floor.
  if (value != null && (!Number.isInteger(value) || value < 0)) {
    return { ok: false, error: "Pick an integer of 0 or more." } as const;
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

// Outright numeric props (migration 0020). Ranges mirror the CHECK constraints
// on tournament_predictions; the DB lock trigger is the real gate.
export async function setFinalGoalsGuess(value: number | null) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 30)) {
    return { ok: false, error: "Pick an integer between 0 and 30." } as const;
  }
  return setTournamentPick({ final_goals_guess: value });
}

export async function setBiggestWinMarginGuess(value: number | null) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 30)) {
    return { ok: false, error: "Pick an integer between 0 and 30." } as const;
  }
  return setTournamentPick({ biggest_win_margin_guess: value });
}

export async function setGoldenBootGoalsGuess(value: number | null) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 30)) {
    return { ok: false, error: "Pick an integer between 0 and 30." } as const;
  }
  return setTournamentPick({ golden_boot_goals_guess: value });
}

export async function setTotalRedCardsGuess(value: number | null) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 200)) {
    return { ok: false, error: "Pick an integer between 0 and 200." } as const;
  }
  return setTournamentPick({ total_red_cards_guess: value });
}

// Admin-resolved "house special" props (migration 0022). User picks are plain
// upserts onto tournament_predictions (round-1 lock enforced by setTournamentPick
// + the DB trigger); the actual result is entered later by an admin in
// /admin/props, which is what triggers scoring.
export async function setNeymarMinutesPick(value: boolean | null) {
  return setTournamentPick({ neymar_minutes_pick: value });
}

export async function setStreakerPick(value: boolean | null) {
  return setTournamentPick({ streaker_pick: value });
}

export async function setBestGoalkeeperPick(playerId: string | null) {
  return setTournamentPick({ best_goalkeeper_player_id: playerId });
}

export async function setGoldenBootTeamPick(teamId: string | null) {
  return setTournamentPick({ golden_boot_team_id: teamId });
}

export async function setWarGamePick(matchId: string | null) {
  return setTournamentPick({ war_game_match_id: matchId });
}

export async function setOwnGoalsGuess(value: number | null) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 50)) {
    return { ok: false, error: "Pick an integer between 0 and 50." } as const;
  }
  return setTournamentPick({ own_goals_guess: value });
}

export async function setSwedishPlayersGuess(value: number | null) {
  if (value != null && (!Number.isInteger(value) || value < 0 || value > 50)) {
    return { ok: false, error: "Pick an integer between 0 and 50." } as const;
  }
  return setTournamentPick({ swedish_players_guess: value });
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

export async function clearBracketPicks(slots: string[]) {
  if (slots.length === 0) return { ok: true } as const;
  const { supabase, user } = await authedClient();
  const locks = await getLocks();
  if (locks.round2Locked) return { ok: false, error: "Round 2 bracket is locked." } as const;
  const { error } = await supabase
    .from("bracket_predictions")
    .delete()
    .eq("user_id", user.id)
    .in("bracket_slot", slots);
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath("/predict/bracket");
  return { ok: true } as const;
}

export async function setBracketPicksBulk(picks: { slot: string; teamId: string }[]) {
  if (picks.length === 0) return { ok: true } as const;
  const { supabase, user } = await authedClient();
  const locks = await getLocks();
  if (locks.round2Locked) return { ok: false, error: "Round 2 bracket is locked." } as const;
  const rows = picks.map((p) => ({
    user_id: user.id,
    bracket_slot: p.slot,
    team_id: p.teamId,
  }));
  const { error } = await supabase
    .from("bracket_predictions")
    .upsert(rows, { onConflict: "user_id,bracket_slot" });
  if (error) return { ok: false, error: error.message } as const;
  revalidatePath("/predict/bracket");
  return { ok: true } as const;
}

const PICK_KINDS = ["match", "bracket", "tournament", "prop"] as const;

export async function togglePickReaction(
  pickId: string,
  kind: PickKind,
  emoji: PickReactionEmoji,
  revalidate?: string,
) {
  if (!PICK_KINDS.includes(kind)) {
    return { ok: false, error: "Invalid pick kind." } as const;
  }
  if (!PICK_REACTION_EMOJI.includes(emoji)) {
    return { ok: false, error: "Invalid emoji." } as const;
  }
  const { supabase, user } = await authedClient();
  const { data: existing, error: selErr } = await supabase
    .from("pick_reactions")
    .select("id")
    .eq("pick_id", pickId)
    .eq("pick_kind", kind)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .maybeSingle();
  if (selErr) return { ok: false, error: selErr.message } as const;

  if (existing) {
    const { error } = await supabase
      .from("pick_reactions")
      .delete()
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message } as const;
  } else {
    const { error } = await supabase
      .from("pick_reactions")
      .insert({ pick_id: pickId, pick_kind: kind, user_id: user.id, emoji });
    if (error) return { ok: false, error: error.message } as const;
  }
  if (revalidate) revalidatePath(revalidate);
  return { ok: true } as const;
}
