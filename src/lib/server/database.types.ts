/**
 * Generated from the live schema. Do not hand-edit.
 *
 * Regenerate after any migration:
 *   npx supabase gen types typescript --project-id <your-project-ref>
 *
 * Only the table shapes are kept — the generator also emits a large set of
 * conditional helper types for schema-qualified lookups that this app has no use
 * for, and carrying them would make a regenerated diff unreadable.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          email_verified_at: string | null;
          password_hash: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          email_verified_at?: string | null;
          password_hash?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          created_at: string;
          last_seen_at: string;
          expires_at: string;
          user_agent: string | null;
          ip: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          token_hash: string;
          created_at?: string;
          last_seen_at?: string;
          expires_at: string;
          user_agent?: string | null;
          ip?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["sessions"]["Insert"]>;
        Relationships: [];
      };
      credentials: {
        Row: {
          id: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          sign_count: number;
          algorithm: number | null;
          backed_up: boolean | null;
          transports: string[] | null;
          label: string | null;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          sign_count?: number;
          algorithm?: number | null;
          backed_up?: boolean | null;
          transports?: string[] | null;
          label?: string | null;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["credentials"]["Insert"]>;
        Relationships: [];
      };
      email_tokens: {
        Row: {
          id: string;
          user_id: string;
          purpose: string;
          token_hash: string;
          expires_at: string;
          consumed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          purpose: string;
          token_hash: string;
          expires_at: string;
          consumed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["email_tokens"]["Insert"]>;
        Relationships: [];
      };
      webauthn_challenges: {
        Row: {
          id: string;
          challenge_hash: string;
          purpose: string;
          user_id: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          challenge_hash: string;
          purpose: string;
          user_id?: string | null;
          expires_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["webauthn_challenges"]["Insert"]>;
        Relationships: [];
      };
      auth_attempts: {
        Row: {
          id: string;
          email: string | null;
          ip: string | null;
          succeeded: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          email?: string | null;
          ip?: string | null;
          succeeded: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["auth_attempts"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          /** Dead since migration 0009. Nothing reads it. */
          clerk_user_id: string | null;
          user_id: string | null;
          handle: string;
          display_name: string;
          country: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clerk_user_id?: string | null;
          user_id?: string | null;
          handle: string;
          display_name: string;
          country?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      solves: {
        Row: {
          humanness: number | null;
          id: string;
          profile_id: string;
          client_id: string;
          event: string;
          scramble: string;
          duration_ms: number;
          penalty: string;
          move_count: number;
          tps: number;
          source: string;
          mode: string;
          verified: boolean;
          reject_reason: string | null;
          moves: Json | null;
          splits: Json;
          oll_case: string | null;
          pll_case: string | null;
          day: number | null;
          solved_at: string;
          created_at: string;
        };
        Insert: {
          humanness?: number | null;
          id?: string;
          profile_id: string;
          client_id: string;
          event?: string;
          scramble: string;
          duration_ms: number;
          penalty: string;
          move_count?: number;
          tps?: number;
          source: string;
          mode: string;
          verified?: boolean;
          reject_reason?: string | null;
          moves?: Json | null;
          splits?: Json;
          oll_case?: string | null;
          pll_case?: string | null;
          day?: number | null;
          solved_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["solves"]["Insert"]>;
        Relationships: [];
      };
      ranked_attempts: {
        Row: {
          id: string;
          profile_id: string;
          event: string;
          pool: string;
          scramble: string;
          issued_at: string;
          expires_at: string;
          status: string;
          solve_id: string | null;
          duration_ms: number | null;
          penalty: string | null;
          completed_at: string | null;
          window_index: number | null;
        };
        Insert: {
          id?: string;
          profile_id: string;
          event?: string;
          pool: string;
          scramble: string;
          issued_at?: string;
          expires_at: string;
          status?: string;
          solve_id?: string | null;
          duration_ms?: number | null;
          penalty?: string | null;
          completed_at?: string | null;
          window_index?: number | null;
        };
        Update: Partial<
          Database["public"]["Tables"]["ranked_attempts"]["Insert"]
        >;
        Relationships: [];
      };
      ratings: {
        Row: {
          profile_id: string;
          event: string;
          pool: string;
          rating: number | null;
          deviation: number;
          solve_count: number;
          peak_rating: number | null;
          last_solve_at: string | null;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          event: string;
          pool: string;
          rating: number | null;
          deviation: number;
          solve_count?: number;
          peak_rating?: number | null;
          last_solve_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ratings"]["Insert"]>;
        Relationships: [];
      };
      rating_events: {
        Row: {
          id: number;
          profile_id: string;
          solve_id: string | null;
          event: string;
          pool: string;
          rating_before: number | null;
          deviation_before: number;
          rating_after: number | null;
          deviation_after: number;
          window_index: number | null;
          at: string;
        };
        Insert: {
          id?: number;
          profile_id: string;
          solve_id?: string | null;
          event: string;
          pool: string;
          rating_before: number | null;
          deviation_before: number;
          rating_after: number | null;
          deviation_after: number;
          window_index?: number | null;
          at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["rating_events"]["Insert"]>;
        Relationships: [];
      };
      duels: {
        Row: {
          id: string;
          profile_id: string;
          event: string;
          scramble: string;
          bot_id: string;
          bot_rating: number;
          bot_duration_ms: number;
          bot_moves: Json;
          seed: number;
          issued_at: string;
          expires_at: string;
          status: string;
          solve_id: string | null;
          player_duration_ms: number | null;
          player_penalty: string | null;
          outcome: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          profile_id: string;
          event?: string;
          scramble: string;
          bot_id: string;
          bot_rating: number;
          bot_duration_ms: number;
          bot_moves: Json;
          seed: number;
          issued_at?: string;
          expires_at: string;
          status?: string;
          solve_id?: string | null;
          player_duration_ms?: number | null;
          player_penalty?: string | null;
          outcome?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["duels"]["Insert"]>;
        Relationships: [];
      };
      challenges: {
        Row: {
          id: string;
          challenger_id: string;
          opponent_id: string;
          event: string;
          source: string;
          scramble: string;
          created_at: string;
          expires_at: string;
          status: string;
          challenger_started_at: string | null;
          challenger_solve_id: string | null;
          challenger_duration_ms: number | null;
          challenger_penalty: string | null;
          opponent_started_at: string | null;
          opponent_solve_id: string | null;
          opponent_duration_ms: number | null;
          opponent_penalty: string | null;
          winner: string | null;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          challenger_id: string;
          opponent_id: string;
          event?: string;
          source?: string;
          scramble: string;
          created_at?: string;
          expires_at: string;
          status?: string;
          challenger_started_at?: string | null;
          challenger_solve_id?: string | null;
          challenger_duration_ms?: number | null;
          challenger_penalty?: string | null;
          opponent_started_at?: string | null;
          opponent_solve_id?: string | null;
          opponent_duration_ms?: number | null;
          opponent_penalty?: string | null;
          winner?: string | null;
          resolved_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["challenges"]["Insert"]>;
        Relationships: [];
      };
      rush_runs: {
        Row: {
          id: string;
          profile_id: string;
          event: string;
          source: string;
          pace_ms: number;
          started_at: string;
          expires_at: string;
          ended_at: string | null;
          status: string;
          current_scramble: string | null;
          current_issued_at: string | null;
          score: number;
          misses: number;
          best_streak: number;
        };
        Insert: {
          id?: string;
          profile_id: string;
          event?: string;
          source?: string;
          pace_ms: number;
          started_at?: string;
          expires_at: string;
          ended_at?: string | null;
          status?: string;
          current_scramble?: string | null;
          current_issued_at?: string | null;
          score?: number;
          misses?: number;
          best_streak?: number;
        };
        Update: Partial<Database["public"]["Tables"]["rush_runs"]["Insert"]>;
        Relationships: [];
      };
      rush_solves: {
        Row: {
          run_id: string;
          position: number;
          solve_id: string | null;
          duration_ms: number;
          penalty: string;
          target_ms: number;
          cleared: boolean;
          at: string;
        };
        Insert: {
          run_id: string;
          position: number;
          solve_id?: string | null;
          duration_ms: number;
          penalty: string;
          target_ms: number;
          cleared: boolean;
          at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["rush_solves"]["Insert"]>;
        Relationships: [];
      };
      daily_results: {
        Row: {
          profile_id: string;
          day: number;
          event: string;
          solve_id: string | null;
          duration_ms: number;
          penalty: string;
          verified: boolean;
          at: string;
        };
        Insert: {
          profile_id: string;
          day: number;
          event?: string;
          solve_id?: string | null;
          duration_ms: number;
          penalty: string;
          verified?: boolean;
          at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["daily_results"]["Insert"]
        >;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      /**
       * Applies one rating window in a single transaction. See the migration for
       * why this cannot be three separate statements from the application.
       */
      apply_rating_window: {
        Args: {
          p_profile_id: string;
          p_event: string;
          p_pool: string;
          p_window_index: number;
          p_rating_before: number | null;
          p_deviation_before: number;
          p_rating_after: number | null;
          p_deviation_after: number;
          p_solve_count: number;
          p_peak_rating: number | null;
          p_at: string;
          p_attempt_ids: string[];
        };
        Returns: undefined;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

export type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Insert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
