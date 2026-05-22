// Database types. Run `npm run db:types` to regenerate from your local Supabase project.
// Until then, this file declares the shape we rely on so the rest of the app compiles.

export type Stage = "GROUP" | "R16" | "QF" | "SF" | "3RD" | "F";
export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED";
export type Pick1X2 = "HOME" | "DRAW" | "AWAY";
export type Winner = "HOME" | "AWAY" | "DRAW" | null;
export type PredictionType = "match" | "bracket" | "tournament" | "prop";
export type LeagueRole = "owner" | "member";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface League {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  description: string | null;
  created_at: string;
}

export interface LeagueMember {
  league_id: string;
  user_id: string;
  role: LeagueRole;
  joined_at: string;
}

export interface LeagueInvite {
  id: string;
  league_id: string;
  token: string;
  expires_at: string | null;
  max_uses: number | null;
  uses_count: number;
  revoked: boolean;
  created_at: string;
}

export interface Tournament {
  id: number;
  first_kickoff_at: string;
  knockout_start_at: string;
  final_at: string;
  locked_overrides: Record<string, unknown> | null;
}

export interface Team {
  id: string;
  external_id: number;
  name: string;
  short_name: string | null;
  code: string;
  crest_url: string | null;
  group_letter: string | null;
  fifa_ranking: number | null;
}

export interface Player {
  id: string;
  external_id: number;
  name: string;
  team_id: string | null;
  position: string | null;
}

export interface Match {
  id: string;
  external_id: number;
  stage: Stage;
  group_letter: string | null;
  bracket_slot: string | null;
  kickoff_at: string;
  home_team_id: string | null;
  away_team_id: string | null;
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  winner: Winner;
  finished_at: string | null;
  details_synced_at: string | null;
}

export interface MatchPrediction {
  id: string;
  user_id: string;
  match_id: string;
  pick: Pick1X2;
  submitted_at: string;
}

export interface BracketPrediction {
  id: string;
  user_id: string;
  bracket_slot: string;
  team_id: string;
  submitted_at: string;
}

export interface TournamentPrediction {
  user_id: string;
  winner_team_id: string | null;
  runner_up_team_id: string | null;
  top_scorer_player_id: string | null;
  dark_horse_team_id: string | null;
  total_goals_guess: number | null;
  highest_match_goals_guess: number | null;
  first_eliminated_team_id: string | null;
  submitted_at: string;
}

export interface GroupWinnerPrediction {
  id: string;
  user_id: string;
  group_letter: string;
  team_id: string;
  submitted_at: string;
}

export type CardType = "YELLOW" | "RED" | "YELLOW_RED";

export interface PlayerCardLog {
  id: string;
  player_id: string;
  match_id: string;
  minute: number | null;
  card_type: CardType;
  recorded_at: string;
}

export interface GroupSettlement {
  group_letter: string;
  winner_team_id: string | null;
  settled_at: string;
}

export interface FirstElimination {
  id: number;
  team_id: string | null;
  detected_at: string | null;
}

export interface PlayerPropPrediction {
  id: string;
  user_id: string;
  prop_key: string;
  player_id: string;
  submitted_at: string;
}

export interface PointAward {
  id: string;
  user_id: string;
  prediction_type: PredictionType;
  prediction_ref: string;
  match_id: string | null;
  points: number;
  idempotency_key: string;
  awarded_at: string;
}

export interface LeagueStandingsRow {
  league_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  total_points: number;
  match_points: number;
  bracket_points: number;
  tournament_points: number;
  prop_points: number;
}
