// Database types. Run `npm run db:types` to regenerate from your local Supabase
// project (`supabase start` + `npm run db:types`). The shape below mirrors what
// `supabase gen types typescript` emits — Database namespace + Tables<>/Enums<>
// helpers — and is the source of truth that supabase-js generics will consume
// once `<Database>` is wired through the clients in `lib/supabase/{client,server}.ts`.
// Five legacy interface aliases at the bottom keep existing call sites working.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      banter_messages: {
        Row: {
          id: string;
          league_id: string;
          user_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          user_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          league_id?: string;
          user_id?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "banter_messages_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "banter_messages_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      banter_replies: {
        Row: {
          id: string;
          message_id: string;
          user_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          user_id: string;
          body: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          message_id?: string;
          user_id?: string;
          body?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "banter_replies_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "banter_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "banter_replies_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      bracket_predictions: {
        Row: {
          id: string;
          user_id: string;
          bracket_slot: string;
          team_id: string;
          submitted_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          bracket_slot: string;
          team_id: string;
          submitted_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          bracket_slot?: string;
          team_id?: string;
          submitted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bracket_predictions_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bracket_predictions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      external_sync_log: {
        Row: {
          id: string;
          source: string;
          endpoint: string;
          status_code: number | null;
          message: string | null;
          payload: Json | null;
          ran_at: string;
        };
        Insert: {
          id?: string;
          source: string;
          endpoint: string;
          status_code?: number | null;
          message?: string | null;
          payload?: Json | null;
          ran_at?: string;
        };
        Update: {
          id?: string;
          source?: string;
          endpoint?: string;
          status_code?: number | null;
          message?: string | null;
          payload?: Json | null;
          ran_at?: string;
        };
        Relationships: [];
      };
      first_elimination: {
        Row: {
          id: number;
          team_id: string | null;
          detected_at: string | null;
        };
        Insert: {
          id?: number;
          team_id?: string | null;
          detected_at?: string | null;
        };
        Update: {
          id?: number;
          team_id?: string | null;
          detected_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "first_elimination_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      league_invites: {
        Row: {
          id: string;
          league_id: string;
          token: string;
          expires_at: string | null;
          max_uses: number | null;
          uses_count: number;
          revoked: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          league_id: string;
          token: string;
          expires_at?: string | null;
          max_uses?: number | null;
          uses_count?: number;
          revoked?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          league_id?: string;
          token?: string;
          expires_at?: string | null;
          max_uses?: number | null;
          uses_count?: number;
          revoked?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "league_invites_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "league_invites_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      league_members: {
        Row: {
          league_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["league_role"];
          joined_at: string;
        };
        Insert: {
          league_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["league_role"];
          joined_at?: string;
        };
        Update: {
          league_id?: string;
          user_id?: string;
          role?: Database["public"]["Enums"]["league_role"];
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "league_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      leagues: {
        Row: {
          id: string;
          slug: string;
          name: string;
          owner_id: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          owner_id: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          owner_id?: string;
          description?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leagues_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      match_predictions: {
        Row: {
          id: string;
          user_id: string;
          match_id: string;
          pick: Database["public"]["Enums"]["pick_1x2"];
          submitted_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          match_id: string;
          pick: Database["public"]["Enums"]["pick_1x2"];
          submitted_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          match_id?: string;
          pick?: Database["public"]["Enums"]["pick_1x2"];
          submitted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_predictions_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "match_predictions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      matches: {
        Row: {
          id: string;
          external_id: number | null;
          stage: Database["public"]["Enums"]["stage"];
          group_letter: string | null;
          bracket_slot: string | null;
          kickoff_at: string;
          home_team_id: string | null;
          away_team_id: string | null;
          status: Database["public"]["Enums"]["match_status"];
          home_score: number | null;
          away_score: number | null;
          winner: Database["public"]["Enums"]["winner"] | null;
          finished_at: string | null;
          created_at: string;
          details_synced_at: string | null;
        };
        Insert: {
          id?: string;
          external_id?: number | null;
          stage: Database["public"]["Enums"]["stage"];
          group_letter?: string | null;
          bracket_slot?: string | null;
          kickoff_at: string;
          home_team_id?: string | null;
          away_team_id?: string | null;
          status?: Database["public"]["Enums"]["match_status"];
          home_score?: number | null;
          away_score?: number | null;
          winner?: Database["public"]["Enums"]["winner"] | null;
          finished_at?: string | null;
          created_at?: string;
          details_synced_at?: string | null;
        };
        Update: {
          id?: string;
          external_id?: number | null;
          stage?: Database["public"]["Enums"]["stage"];
          group_letter?: string | null;
          bracket_slot?: string | null;
          kickoff_at?: string;
          home_team_id?: string | null;
          away_team_id?: string | null;
          status?: Database["public"]["Enums"]["match_status"];
          home_score?: number | null;
          away_score?: number | null;
          winner?: Database["public"]["Enums"]["winner"] | null;
          finished_at?: string | null;
          created_at?: string;
          details_synced_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "matches_away_team_id_fkey";
            columns: ["away_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_home_team_id_fkey";
            columns: ["home_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      pick_reactions: {
        Row: {
          id: string;
          pick_id: string;
          pick_kind: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          pick_id: string;
          pick_kind: string;
          user_id: string;
          emoji: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          pick_id?: string;
          pick_kind?: string;
          user_id?: string;
          emoji?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pick_reactions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      player_card_log: {
        Row: {
          id: string;
          player_id: string;
          match_id: string;
          minute: number | null;
          card_type: string;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          player_id: string;
          match_id: string;
          minute?: number | null;
          card_type: string;
          recorded_at?: string;
        };
        Update: {
          id?: string;
          player_id?: string;
          match_id?: string;
          minute?: number | null;
          card_type?: string;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_card_log_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "player_card_log_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      player_goal_log: {
        Row: {
          id: string;
          player_id: string;
          match_id: string;
          minute: number | null;
          recorded_at: string;
        };
        Insert: {
          id?: string;
          player_id: string;
          match_id: string;
          minute?: number | null;
          recorded_at?: string;
        };
        Update: {
          id?: string;
          player_id?: string;
          match_id?: string;
          minute?: number | null;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_goal_log_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "player_goal_log_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      player_prop_predictions: {
        Row: {
          id: string;
          user_id: string;
          prop_key: string;
          player_id: string;
          submitted_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          prop_key: string;
          player_id: string;
          submitted_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          prop_key?: string;
          player_id?: string;
          submitted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_prop_predictions_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "player_prop_predictions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      player_prop_resolutions: {
        Row: {
          prop_key: string;
          player_id: string;
          resolved_at: string;
        };
        Insert: {
          prop_key: string;
          player_id: string;
          resolved_at?: string;
        };
        Update: {
          prop_key?: string;
          player_id?: string;
          resolved_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_prop_resolutions_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      players: {
        Row: {
          id: string;
          external_id: number | null;
          name: string;
          team_id: string | null;
          position: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          external_id?: number | null;
          name: string;
          team_id?: string | null;
          position?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          external_id?: number | null;
          name?: string;
          team_id?: string | null;
          position?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      league_group_bets: {
        Row: {
          league_id: string;
          voter_id: string;
          bet_kind: string;
          votee_id: string;
          created_at: string;
        };
        Insert: {
          league_id: string;
          voter_id: string;
          bet_kind: string;
          votee_id: string;
          created_at?: string;
        };
        Update: {
          league_id?: string;
          voter_id?: string;
          bet_kind?: string;
          votee_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "league_group_bets_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "league_group_bets_voter_id_fkey";
            columns: ["voter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "league_group_bets_votee_id_fkey";
            columns: ["votee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      point_awards: {
        Row: {
          id: string;
          user_id: string;
          prediction_type: Database["public"]["Enums"]["prediction_type"];
          prediction_ref: string | null;
          match_id: string | null;
          league_id: string | null;
          points: number;
          idempotency_key: string;
          awarded_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          prediction_type: Database["public"]["Enums"]["prediction_type"];
          prediction_ref?: string | null;
          match_id?: string | null;
          league_id?: string | null;
          points: number;
          idempotency_key: string;
          awarded_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          prediction_type?: Database["public"]["Enums"]["prediction_type"];
          prediction_ref?: string | null;
          match_id?: string | null;
          league_id?: string | null;
          points?: number;
          idempotency_key?: string;
          awarded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "point_awards_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "point_awards_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "point_awards_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          is_admin: boolean;
          onboarded: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          is_admin?: boolean;
          onboarded?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          is_admin?: boolean;
          onboarded?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          external_id: number | null;
          name: string;
          short_name: string | null;
          code: string;
          crest_url: string | null;
          group_letter: string | null;
          fifa_ranking: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          external_id?: number | null;
          name: string;
          short_name?: string | null;
          code: string;
          crest_url?: string | null;
          group_letter?: string | null;
          fifa_ranking?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          external_id?: number | null;
          name?: string;
          short_name?: string | null;
          code?: string;
          crest_url?: string | null;
          group_letter?: string | null;
          fifa_ranking?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      tournament: {
        Row: {
          id: number;
          first_kickoff_at: string;
          knockout_start_at: string;
          final_at: string;
          locked_overrides: Json;
        };
        Insert: {
          id?: number;
          first_kickoff_at: string;
          knockout_start_at: string;
          final_at: string;
          locked_overrides?: Json;
        };
        Update: {
          id?: number;
          first_kickoff_at?: string;
          knockout_start_at?: string;
          final_at?: string;
          locked_overrides?: Json;
        };
        Relationships: [];
      };
      tournament_predictions: {
        Row: {
          user_id: string;
          winner_team_id: string | null;
          runner_up_team_id: string | null;
          top_scorer_player_id: string | null;
          dark_horse_team_id: string | null;
          total_goals_guess: number | null;
          highest_match_goals_guess: number | null;
          first_eliminated_team_id: string | null;
          final_goals_guess: number | null;
          biggest_win_margin_guess: number | null;
          golden_boot_goals_guess: number | null;
          total_red_cards_guess: number | null;
          submitted_at: string;
        };
        Insert: {
          user_id: string;
          winner_team_id?: string | null;
          runner_up_team_id?: string | null;
          top_scorer_player_id?: string | null;
          dark_horse_team_id?: string | null;
          total_goals_guess?: number | null;
          highest_match_goals_guess?: number | null;
          first_eliminated_team_id?: string | null;
          final_goals_guess?: number | null;
          biggest_win_margin_guess?: number | null;
          golden_boot_goals_guess?: number | null;
          total_red_cards_guess?: number | null;
          submitted_at?: string;
        };
        Update: {
          user_id?: string;
          winner_team_id?: string | null;
          runner_up_team_id?: string | null;
          top_scorer_player_id?: string | null;
          dark_horse_team_id?: string | null;
          total_goals_guess?: number | null;
          highest_match_goals_guess?: number | null;
          first_eliminated_team_id?: string | null;
          final_goals_guess?: number | null;
          biggest_win_margin_guess?: number | null;
          golden_boot_goals_guess?: number | null;
          total_red_cards_guess?: number | null;
          submitted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tournament_predictions_dark_horse_team_id_fkey";
            columns: ["dark_horse_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tournament_predictions_first_eliminated_team_id_fkey";
            columns: ["first_eliminated_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tournament_predictions_runner_up_team_id_fkey";
            columns: ["runner_up_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tournament_predictions_top_scorer_player_id_fkey";
            columns: ["top_scorer_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tournament_predictions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tournament_predictions_winner_team_id_fkey";
            columns: ["winner_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      league_standings: {
        Row: {
          league_id: string | null;
          user_id: string | null;
          username: string | null;
          display_name: string | null;
          match_points: number | null;
          bracket_points: number | null;
          tournament_points: number | null;
          prop_points: number | null;
          total_points: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      backfill_team_group_letters: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      banter_message_league_id: {
        Args: { p_message_id: string };
        Returns: string;
      };
      debug_auth_uid: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      is_league_member: {
        Args: { p_league_id: string; p_user_id: string };
        Returns: boolean;
      };
      redeem_league_invite: {
        Args: { p_token: string; p_user_id: string };
        Returns: {
          ok: boolean;
          league_slug: string;
          error: string;
        }[];
      };
      refresh_league_standings: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      round1_locked: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      round2_locked: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      score_bracket: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      score_first_eliminated: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      score_highest_match_goals_guess: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      score_match: {
        Args: { p_match_id: string };
        Returns: number;
      };
      score_total_goals_guess: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      score_tournament: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      score_troublemaker: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      settle_group_stage_props: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      tournament_locks: {
        Args: Record<PropertyKey, never>;
        Returns: {
          first_kickoff_at: string;
          knockout_start_at: string;
        }[];
      };
    };
    Enums: {
      league_role: "owner" | "member";
      match_status: "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED";
      pick_1x2: "HOME" | "DRAW" | "AWAY";
      prediction_type: "match" | "bracket" | "tournament" | "prop";
      stage: "GROUP" | "R32" | "R16" | "QF" | "SF" | "3RD" | "F";
      winner: "HOME" | "DRAW" | "AWAY";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DefaultSchema = Database[Extract<keyof Database, "public">];

export type Tables<
  TableName extends keyof DefaultSchema["Tables"] | keyof DefaultSchema["Views"],
> = TableName extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][TableName]["Row"]
  : TableName extends keyof DefaultSchema["Views"]
    ? DefaultSchema["Views"][TableName]["Row"]
    : never;

export type TablesInsert<TableName extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][TableName]["Insert"];

export type TablesUpdate<TableName extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][TableName]["Update"];

export type Enums<EnumName extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][EnumName];

export const Constants = {
  public: {
    Enums: {
      league_role: ["owner", "member"],
      match_status: ["SCHEDULED", "LIVE", "FINISHED", "POSTPONED"],
      pick_1x2: ["HOME", "DRAW", "AWAY"],
      prediction_type: ["match", "bracket", "tournament", "prop"],
      stage: ["GROUP", "R32", "R16", "QF", "SF", "3RD", "F"],
      winner: ["HOME", "DRAW", "AWAY"],
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Backward-compat aliases: the legacy interface names that pre-existed this
// regen. Kept as type aliases pointing at the new namespace so existing
// imports (`import type { Pick1X2, BanterMessage, ... }`) keep working.
// New code should prefer `Tables<"...">` / `Enums<"...">` from the namespace.
// ---------------------------------------------------------------------------

export type Pick1X2 = Enums<"pick_1x2">;
export type Tournament = Tables<"tournament">;
export type BanterMessage = Tables<"banter_messages">;
export type BanterReply = Tables<"banter_replies">;
export type LeagueStandingsRow = {
  league_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  total_points: number;
  match_points: number;
  bracket_points: number;
  tournament_points: number;
  prop_points: number;
};
export type LeagueGroupBet = Tables<"league_group_bets">;
