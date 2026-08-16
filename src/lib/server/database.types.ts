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
      profiles: {
        Row: {
          id: string;
          clerk_user_id: string;
          handle: string;
          display_name: string;
          country: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          clerk_user_id: string;
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
          rating: number;
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
          rating: number;
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
          rating_before: number;
          deviation_before: number;
          rating_after: number;
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
          rating_before: number;
          deviation_before: number;
          rating_after: number;
          deviation_after: number;
          window_index?: number | null;
          at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["rating_events"]["Insert"]>;
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
          p_rating_before: number;
          p_deviation_before: number;
          p_rating_after: number;
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
