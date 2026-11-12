/**
 * Hand-written mirror of the SQL in `supabase/migrations/`.
 *
 * This is the source of truth for the `Database` generic passed to every
 * Supabase client in `src/lib/supabase/`. If you change a migration, change
 * this file in the same commit — nothing regenerates it automatically.
 *
 * Shape follows what `@supabase/supabase-js` expects:
 *   Database['public']['Tables'][name]['Row' | 'Insert' | 'Update']
 *   Database['public']['Enums'][name]
 *
 * Column nullability rules used throughout:
 *   Row     — `| null` exactly when the SQL column is nullable.
 *   Insert  — optional when the column is nullable or has a DEFAULT.
 *   Update  — every column optional.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '13'
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string | null
          avatar_url: string | null
          /** Immutable once set — see profiles_freeze_wallet_address. */
          wallet_address: string | null
          /** Unique, lowercase. Null on accounts predating registration. */
          username: string | null
          created_at: string
        }
        Insert: {
          /** Must equal auth.uid(); normally written by the on_auth_user_created trigger. */
          id: string
          display_name?: string | null
          avatar_url?: string | null
          wallet_address?: string | null
          username?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string | null
          avatar_url?: string | null
          /** Writable only while null; the freeze trigger rejects the rest. */
          wallet_address?: string | null
          username?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_id_fkey'
            columns: ['id']
            isOneToOne: true
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      projects: {
        Row: {
          id: string
          owner_id: string
          name: string
          slug: string
          description: string | null
          status: Database['public']['Enums']['project_status']
          repo_url: string | null
          demo_url: string | null
          docs_url: string | null
          chain_contract_id: string | null
          chain_network: Database['public']['Enums']['stellar_network'] | null
          chain_owner_address: string | null
          chain_registered_tx: string | null
          chain_registered_at: string | null
          /** Publishes this project's milestone proofs to anyone with a link. */
          public_proofs: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_id: string
          name: string
          slug: string
          description?: string | null
          status?: Database['public']['Enums']['project_status']
          repo_url?: string | null
          demo_url?: string | null
          docs_url?: string | null
          /**
           * `projects_chain_registration_complete`: the five chain_* columns
           * are all null or all set. A contract id without the tx that proves
           * it was written is a claim, not a record.
           */
          chain_contract_id?: string | null
          chain_network?: Database['public']['Enums']['stellar_network'] | null
          chain_owner_address?: string | null
          chain_registered_tx?: string | null
          chain_registered_at?: string | null
          public_proofs?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          owner_id?: string
          name?: string
          slug?: string
          description?: string | null
          status?: Database['public']['Enums']['project_status']
          repo_url?: string | null
          demo_url?: string | null
          docs_url?: string | null
          chain_contract_id?: string | null
          chain_network?: Database['public']['Enums']['stellar_network'] | null
          chain_owner_address?: string | null
          chain_registered_tx?: string | null
          chain_registered_at?: string | null
          public_proofs?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'projects_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      project_members: {
        Row: {
          project_id: string
          user_id: string
          role: Database['public']['Enums']['member_role']
          joined_at: string
        }
        Insert: {
          project_id: string
          user_id: string
          role?: Database['public']['Enums']['member_role']
          joined_at?: string
        }
        Update: {
          project_id?: string
          user_id?: string
          role?: Database['public']['Enums']['member_role']
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_members_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      milestones: {
        Row: {
          id: string
          project_id: string
          title: string
          description: string | null
          status: Database['public']['Enums']['milestone_status']
          /** `date` column — serialised as `YYYY-MM-DD`, not an ISO timestamp. */
          due_date: string | null
          order_index: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          title: string
          description?: string | null
          status?: Database['public']['Enums']['milestone_status']
          due_date?: string | null
          order_index?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          title?: string
          description?: string | null
          status?: Database['public']['Enums']['milestone_status']
          due_date?: string | null
          order_index?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'milestones_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }

      tasks: {
        Row: {
          id: string
          project_id: string
          milestone_id: string | null
          title: string
          description: string | null
          status: Database['public']['Enums']['task_status']
          assignee_id: string | null
          /** `date` column — serialised as `YYYY-MM-DD`, not an ISO timestamp. */
          due_date: string | null
          order_index: number
          /**
           * `not null default 'medium'`, so a task always has one and the app
           * never has an "unset" case to render. `TASK_PRIORITY` in
           * `constants.ts` holds the labels and the P0–P3 board notation.
           */
          priority: Database['public']['Enums']['task_priority']
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          milestone_id?: string | null
          title: string
          description?: string | null
          status?: Database['public']['Enums']['task_status']
          assignee_id?: string | null
          due_date?: string | null
          order_index?: number
          priority?: Database['public']['Enums']['task_priority']
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          milestone_id?: string | null
          title?: string
          description?: string | null
          status?: Database['public']['Enums']['task_status']
          assignee_id?: string | null
          due_date?: string | null
          order_index?: number
          priority?: Database['public']['Enums']['task_priority']
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tasks_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_milestone_id_fkey'
            columns: ['milestone_id']
            isOneToOne: false
            referencedRelation: 'milestones'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tasks_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      stellar_proofs: {
        Row: {
          id: string
          project_id: string
          milestone_id: string | null
          contract_id: string | null
          tx_hash: string | null
          network: Database['public']['Enums']['stellar_network']
          wallet_address: string | null
          proof_url: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          milestone_id?: string | null
          /**
           * `stellar_proofs_has_evidence` requires at least one of
           * `contract_id`, `tx_hash` or `proof_url` to be non-blank.
           */
          contract_id?: string | null
          tx_hash?: string | null
          network?: Database['public']['Enums']['stellar_network']
          wallet_address?: string | null
          proof_url?: string | null
          notes?: string | null
          /** RLS pins this to auth.uid() on insert. */
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          milestone_id?: string | null
          contract_id?: string | null
          tx_hash?: string | null
          network?: Database['public']['Enums']['stellar_network']
          wallet_address?: string | null
          proof_url?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'stellar_proofs_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'stellar_proofs_milestone_id_fkey'
            columns: ['milestone_id']
            isOneToOne: false
            referencedRelation: 'milestones'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'stellar_proofs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      deployments: {
        Row: {
          id: string
          project_id: string
          status: Database['public']['Enums']['deployment_status']
          network: Database['public']['Enums']['stellar_network'] | null
          contract_id: string | null
          tx_hash: string | null
          release_notes: string | null
          deployed_by: string | null
          deployed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          status?: Database['public']['Enums']['deployment_status']
          /** `deployments_network_required`: mandatory unless status is 'not_started'. */
          network?: Database['public']['Enums']['stellar_network'] | null
          contract_id?: string | null
          tx_hash?: string | null
          release_notes?: string | null
          deployed_by?: string | null
          deployed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          status?: Database['public']['Enums']['deployment_status']
          network?: Database['public']['Enums']['stellar_network'] | null
          contract_id?: string | null
          tx_hash?: string | null
          release_notes?: string | null
          deployed_by?: string | null
          deployed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'deployments_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'deployments_deployed_by_fkey'
            columns: ['deployed_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      milestone_anchors: {
        Row: {
          id: string
          milestone_id: string
          project_id: string
          action: Database['public']['Enums']['anchor_action']
          proof_hash: string | null
          version: number
          contract_id: string
          network: Database['public']['Enums']['stellar_network']
          tx_hash: string
          signer_address: string
          ledger: number | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          milestone_id: string
          project_id: string
          action: Database['public']['Enums']['anchor_action']
          /**
           * `milestone_anchors_hash_matches_action`: required for 'submit',
           * forbidden otherwise — approve and reject attest to a hash already
           * on chain rather than supplying a new one. 64 lowercase hex chars.
           */
          proof_hash?: string | null
          version: number
          contract_id: string
          network?: Database['public']['Enums']['stellar_network']
          /** 64 lowercase hex chars, unique across the table. */
          tx_hash: string
          signer_address: string
          ledger?: number | null
          created_by?: string | null
          created_at?: string
        }
        /**
         * Append-only: there is no UPDATE or DELETE policy on this table, so
         * nothing here is reachable through the anon or authenticated roles.
         * Present only because the Database generic requires the key.
         */
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'milestone_anchors_milestone_id_fkey'
            columns: ['milestone_id']
            isOneToOne: false
            referencedRelation: 'milestones'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'milestone_anchors_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'milestone_anchors_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      milestone_reviews: {
        Row: {
          id: string
          milestone_id: string
          project_id: string
          from_status: Database['public']['Enums']['milestone_status']
          to_status: Database['public']['Enums']['milestone_status']
          reason: string | null
          reviewer_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          milestone_id: string
          project_id: string
          from_status: Database['public']['Enums']['milestone_status']
          to_status: Database['public']['Enums']['milestone_status']
          /**
           * `milestone_reviews_rejection_has_reason`: required when `to_status`
           * is 'rejected', optional otherwise. 1–2000 characters once trimmed.
           */
          reason?: string | null
          reviewer_id?: string | null
          created_at?: string
        }
        /**
         * Append-only, like milestone_anchors: no UPDATE or DELETE policy, so
         * nothing here is reachable through the authenticated role. A reason
         * that can be edited after it was read is not a record.
         */
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'milestone_reviews_milestone_id_fkey'
            columns: ['milestone_id']
            isOneToOne: false
            referencedRelation: 'milestones'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'milestone_reviews_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'milestone_reviews_reviewer_id_fkey'
            columns: ['reviewer_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      notifications: {
        Row: {
          id: string
          recipient_id: string
          project_id: string
          milestone_id: string | null
          kind: Database['public']['Enums']['notification_kind']
          body: string
          actor_id: string | null
          read_at: string | null
          created_at: string
        }
        /**
         * Written by `notify_milestone_status()`, never by a client — there is
         * no INSERT policy on this table. Present only because the Database
         * generic requires the key.
         */
        Insert: Record<string, never>
        /** Marking read is the only edit the UPDATE policy permits. */
        Update: {
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_milestone_id_fkey'
            columns: ['milestone_id']
            isOneToOne: false
            referencedRelation: 'milestones'
            referencedColumns: ['id']
          },
        ]
      }
      api_requests: {
        Row: {
          id: string
          /** The `X-Request-Id` the response carried. */
          request_id: string
          /** OAuth client id from the token's `client_id` claim. */
          client_id: string
          user_id: string
          method: string
          path: string
          status: number
          created_at: string
        }
        /**
         * Written only by `lib/api/audit.ts` with the secret key; RLS has no
         * policies and `authenticated` holds no grant on this table.
         */
        Insert: {
          id?: string
          request_id: string
          client_id: string
          user_id: string
          method: string
          path: string
          status: number
          created_at?: string
        }
        /** Append-only: no role the app uses may update a row. */
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'api_requests_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * A doqtri doc linked to a project (20261024120000_integration_links.sql).
       * `doc_id` is unique: a doc belongs to at most one project (D-09).
       */
      project_doc_links: {
        Row: {
          id: string
          project_id: string
          /** doqtri's `documents.id`. */
          doc_id: string
          doc_title: string
          /** Always `https://`. */
          doc_url: string
          linked_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          doc_id: string
          doc_title: string
          doc_url: string
          linked_by?: string | null
          created_at?: string
          updated_at?: string
        }
        /**
         * No client updates (or inserts) a doc link directly: both are revoked
         * from `authenticated` (D-48). The title and URL are refreshed only by
         * `link_project_doc`, which an app calls through the API (D-60). Kept
         * for the trigger's shape: these are the only columns that ever move.
         */
        Update: {
          doc_title?: string
          doc_url?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_doc_links_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * The doqtri heading a milestone is linked to. While a row exists the
       * milestone's title is doqtri's (D-12); `node_label` always equals it.
       */
      milestone_external_links: {
        Row: {
          id: string
          milestone_id: string
          project_id: string
          source: 'doqtri'
          doc_id: string
          /** doqtri positional node id: `root`, `h0`, `h1`, ... */
          node_id: string
          node_label: string
          /** DoqtriRegistry `Document.version`, or null when not anchored. */
          doc_version: number | null
          /** Copy of `project_doc_links.doc_title`, kept in step by trigger. */
          doc_title: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          milestone_id: string
          project_id: string
          source?: 'doqtri'
          doc_id: string
          node_id: string
          /** Must equal the milestone's title. */
          node_label: string
          doc_version?: number | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        /**
         * Only these move after insert (D-21); a trigger refuses the rest.
         * `node_label` follows the milestone title by trigger.
         */
        Update: {
          node_id?: string
          doc_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'milestone_external_links_milestone_id_fkey'
            columns: ['milestone_id']
            isOneToOne: true
            referencedRelation: 'milestones'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'milestone_external_links_doc_fkey'
            columns: ['project_id', 'doc_id']
            isOneToOne: false
            referencedRelation: 'project_doc_links'
            referencedColumns: ['project_id', 'doc_id']
          },
        ]
      }

      /**
       * Which (user, OAuth client) pairs have written a doc link or its
       * milestone links, and whether that grant is still usable
       * (20261025120600_doc_link_connections.sql). Project viewers read
       * doc_link_id, lost_at and lost_reason only (column grants: selecting
       * any other column is refused); apps see nothing. Written only by triggers and
       * `mark_doc_link_connections_revoked`.
       */
      doc_link_connections: {
        Row: {
          id: string
          doc_link_id: string
          user_id: string
          client_id: string
          last_write_at: string
          /** Null while the connection is live. */
          lost_at: string | null
          lost_reason: 'revoked' | 'left_project' | null
        }
        /** `authenticated` holds no write grant on this table. */
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'doc_link_connections_doc_link_id_fkey'
            columns: ['doc_link_id']
            isOneToOne: false
            referencedRelation: 'project_doc_links'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * When each user last revoked each OAuth client
       * (20261025130000_oauth_revocations.sql, D-59). No client role can read
       * or write it; `record_oauth_client_revocation` and
       * `mark_doc_link_connections_revoked` write it, `oauth_token_revoked`
       * reads it.
       */
      oauth_client_revocations: {
        Row: {
          user_id: string
          client_id: string
          revoked_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }

      /**
       * One row of per-environment integration config, written by an operator
       * in the SQL editor (20261025130000_oauth_revocations.sql). No client
       * role can read it.
       */
      integration_settings: {
        Row: {
          id: true
          /** doqtri's OAuth client id here (D-61); null until set. */
          doqtri_oauth_client_id: string | null
          /** doqtri's origin here (D-77, D-95): https, lower case, no path; null until set. */
          doqtri_origin: string | null
          updated_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }

      /**
       * Where qdit sends milestone events (20261024130000_integration_webhooks.sql).
       * No client role can read it; the cron route reads it only through
       * `claim_integration_events`. The secret columns are ciphertext
       * (`lib/webhooks/secret-box.ts`), never a plain secret.
       */
      integration_webhooks: {
        Row: {
          id: string
          /** The OAuth client this endpoint belongs to. */
          client_id: string
          link_source: 'doqtri'
          target_url: string
          secret_ciphertext: string
          /** Set during rotation; deliveries are then signed with both. */
          next_secret_ciphertext: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        /** Written by an operator in the SQL editor, never by the app. */
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }

      /**
       * The webhook outbox. Written by trigger; settled only through
       * `record_integration_delivery`. `id` is the event id.
       */
      integration_events: {
        Row: {
          id: string
          seq: number
          webhook_id: string
          milestone_id: string
          project_id: string
          event: 'milestone.status_changed'
          status: Database['public']['Enums']['milestone_status']
          cause: 'status_changed' | 'anchor_recorded'
          occurred_at: string
          attempts: number
          next_attempt_at: string
          claim_token: string | null
          delivered_at: string | null
          dead_at: string | null
          last_error: string | null
          created_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'integration_events_webhook_id_fkey'
            columns: ['webhook_id']
            isOneToOne: false
            referencedRelation: 'integration_webhooks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'integration_events_milestone_id_fkey'
            columns: ['milestone_id']
            isOneToOne: false
            referencedRelation: 'milestones'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * A hackathon (20261110100000_hackathons.sql, D-115). Created, edited
       * and deleted through `create_hackathon` / `update_hackathon` /
       * `delete_hackathon` (QDIT-56); every signed-in first-party user reads it.
       * `released_at` is set once by `release_hackathon_grades` (D-116).
       */
      hackathons: {
        Row: {
          id: string
          /** `^[a-z0-9-]{1,64}$`. */
          slug: string
          name: string
          description: string | null
          opens_at: string
          closes_at: string
          team_min: number
          team_max: number
          /** 1–10. */
          finalist_count: number
          /** Unlisted (QDIT-56): out of the banner and non-staff's index; the page still opens by link. */
          hidden: boolean
          released_at: string | null
          released_by: string | null
          created_at: string
        }
        /** `authenticated` holds no write grant on any hackathon table. */
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }

      /**
       * Hackathon admins and judges. Staff read their hackathon's rows, a user
       * their own; written only by `set_hackathon_staff` (and operator SQL for
       * the first admin).
       */
      hackathon_staff: {
        Row: {
          hackathon_id: string
          user_id: string
          role: Database['public']['Enums']['hackathon_role']
          added_by: string | null
          created_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_staff_hackathon_id_fkey'
            columns: ['hackathon_id']
            isOneToOne: false
            referencedRelation: 'hackathons'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * Per-project extension past `closes_at` (`grant_late_pass`). Read by
       * the hackathon's admins and the project's members.
       */
      hackathon_late_passes: {
        Row: {
          hackathon_id: string
          project_id: string
          /** While now() <= until, closes_at does not apply to the project. */
          until: string
          granted_by: string | null
          created_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_late_passes_hackathon_id_fkey'
            columns: ['hackathon_id']
            isOneToOne: false
            referencedRelation: 'hackathons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hackathon_late_passes_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * Insert-only doqtri workspace snapshots (D-117), written by
       * `push_doqtri_hackathon_snapshot`. Read by the project's members and
       * the hackathon's staff, never by an OAuth app. Pruned 90 days after
       * the hackathon closes.
       */
      hackathon_doqtri_snapshots: {
        Row: {
          /** qdit's id: the contract's response `id`. */
          id: string
          /** doqtri's idempotency key, unique per project. */
          snapshot_id: string
          hackathon_id: string
          project_id: string
          workspace_id: string
          pushed_by: string | null
          client_id: string
          /** The request body (DoqtriSnapshotV1, lib/hackathon/types.ts). */
          payload: Json
          /** SHA-256 of the raw body bytes, lowercase hex. */
          payload_sha256: string
          note_count: number
          received_at: string
          /** Written later by `record_doqtri_chain_check`; null until then. */
          chain_check: Json | null
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_doqtri_snapshots_hackathon_id_fkey'
            columns: ['hackathon_id']
            isOneToOne: false
            referencedRelation: 'hackathons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hackathon_doqtri_snapshots_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * One entry per project per hackathon (D-115). Read by the project's
       * members and the hackathon's staff; written by `submit_hackathon_entry`.
       * `updated_at` is not granted to clients (D-116): select the other
       * columns by name, since `select('*')` is refused. An admin's
       * eligibility override is in `hackathon_eligibility_overrides`.
       */
      hackathon_submissions: {
        Row: {
          id: string
          hackathon_id: string
          project_id: string
          /** Trimmed, 1–80 characters. */
          team_name: string
          /** Null only inside the submitting transaction. */
          current_version_id: string | null
          created_by: string | null
          created_at: string
          /** Not granted to clients. */
          updated_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_submissions_hackathon_id_fkey'
            columns: ['hackathon_id']
            isOneToOne: false
            referencedRelation: 'hackathons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hackathon_submissions_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hackathon_submissions_current_version_fkey'
            columns: ['current_version_id']
            isOneToOne: false
            referencedRelation: 'hackathon_submission_versions'
            referencedColumns: ['id']
          },
        ]
      }

      /** The current team of each entry; one team per person per hackathon. */
      hackathon_team_members: {
        Row: {
          hackathon_id: string
          submission_id: string
          user_id: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_team_members_submission_fkey'
            columns: ['submission_id', 'hackathon_id']
            isOneToOne: false
            referencedRelation: 'hackathon_submissions'
            referencedColumns: ['id', 'hackathon_id']
          },
        ]
      }

      /**
       * Insert-only versions of an entry. Only `eligibility` changes, through
       * `set_version_eligibility` (service_role). `eligibility` is not granted
       * to clients (D-116): select the other columns by name, since
       * `select('*')` is refused. Admins read it through
       * `hackathon_grading_status`.
       */
      hackathon_submission_versions: {
        Row: {
          id: string
          submission_id: string
          version_no: number
          team_name: string
          member_ids: string[]
          /** QditSnapshotV1 (lib/hackathon/types.ts), frozen at submit. */
          qdit_snapshot: Json
          /** The newest doqtri push at submit; null if none or pruned. */
          doqtri_snapshot_id: string | null
          /** 1–3 `<hackathon>/<project>/<uuid>.<ext>` in hackathon-mindmaps. */
          image_paths: string[]
          /** QDIT-63. The team's Slides link; null only on versions from before migration 20261112062735. */
          slides_url: string | null
          submitted_by: string | null
          submitted_at: string
          /** Not granted to clients. `{eligible: boolean, rules: [...]}`; null until the grader runs. */
          eligibility: Json | null
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_submission_versions_submission_id_fkey'
            columns: ['submission_id']
            isOneToOne: false
            referencedRelation: 'hackathon_submissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hackathon_submission_versions_doqtri_snapshot_id_fkey'
            columns: ['doqtri_snapshot_id']
            isOneToOne: false
            referencedRelation: 'hackathon_doqtri_snapshots'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * The AI grading queue (D-119). No client role can read it; the grader
       * uses the service-role RPCs.
       */
      hackathon_grading_jobs: {
        Row: {
          id: string
          version_id: string
          /** 1–9: runs 1 and 2, then the third run and regrades. */
          run_no: number
          status: 'pending' | 'running' | 'done' | 'failed' | 'superseded'
          /** Claims so far; only grows, and is the lease's fencing token. */
          attempts: number
          /** Claims that did not count (overload, budget abort); the limit is attempts - free_attempts <= 3. */
          free_attempts: number
          lease_until: string | null
          next_attempt_at: string
          /** A code (`^[a-z0-9_:.-]{1,80}$`), never prose. */
          last_error: string | null
          created_at: string
          updated_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_grading_jobs_version_id_fkey'
            columns: ['version_id']
            isOneToOne: false
            referencedRelation: 'hackathon_submission_versions'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * Sealed AI review results (D-116). No client role can read them;
       * admins reach them only through `hackathon_leaderboard` after release.
       */
      hackathon_ai_runs: {
        Row: {
          id: string
          version_id: string
          run_no: number
          model: string
          criteria: Json
          /** 0–100, two decimals. */
          total: number
          flags: string[]
          summary: string | null
          stop_reason: string | null
          usage: Json | null
          truncated: boolean
          created_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_ai_runs_version_id_fkey'
            columns: ['version_id']
            isOneToOne: false
            referencedRelation: 'hackathon_submission_versions'
            referencedColumns: ['id']
          },
        ]
      }

      /**
       * Written by `release_hackathon_grades`. No client grant: judges list
       * finalists through `hackathon_finals_for_judge`, admins through
       * `hackathon_leaderboard`.
       */
      hackathon_finalists: {
        Row: {
          hackathon_id: string
          submission_id: string
          pitch_order: number | null
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_finalists_submission_fkey'
            columns: ['submission_id', 'hackathon_id']
            isOneToOne: false
            referencedRelation: 'hackathon_submissions'
            referencedColumns: ['id', 'hackathon_id']
          },
        ]
      }

      /**
       * Sealed (D-116): each finalist's AI rank. No client grant; admins read
       * it through `hackathon_leaderboard`.
       */
      hackathon_finalist_ranks: {
        Row: {
          hackathon_id: string
          submission_id: string
          ai_rank: number
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_finalist_ranks_finalist_fkey'
            columns: ['hackathon_id', 'submission_id']
            isOneToOne: false
            referencedRelation: 'hackathon_finalists'
            referencedColumns: ['hackathon_id', 'submission_id']
          },
        ]
      }

      /**
       * An admin's eligibility call on an entry (D-116). Staff-only, no
       * client grant: written by `set_eligibility_override`, read through
       * `hackathon_grading_status` and `hackathon_leaderboard`.
       */
      hackathon_eligibility_overrides: {
        Row: {
          submission_id: string
          hackathon_id: string
          /** Wins over the computed eligibility. */
          value: boolean
          reason: string
          overridden_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_eligibility_overrides_submission_fkey'
            columns: ['submission_id', 'hackathon_id']
            isOneToOne: false
            referencedRelation: 'hackathon_submissions'
            referencedColumns: ['id', 'hackathon_id']
          },
        ]
      }

      /**
       * A judge's 5 × 1–5 scores for one finalist (D-119). A judge reads their
       * own rows after release; written only by `upsert_judge_score`.
       */
      hackathon_judge_scores: {
        Row: {
          id: string
          hackathon_id: string
          submission_id: string
          judge_id: string
          clarity: number
          structure: number
          accuracy: number
          connections: number
          pitch: number
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'hackathon_judge_scores_finalist_fkey'
            columns: ['hackathon_id', 'submission_id']
            isOneToOne: false
            referencedRelation: 'hackathon_finalists'
            referencedColumns: ['hackathon_id', 'submission_id']
          },
        ]
      }
    }

    Views: Record<string, never>

    Functions: {
      is_project_member: {
        Args: { p_project_id: string; p_min_role?: string }
        Returns: boolean
      }
      shares_project_with: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      member_role_rank: {
        Args: { p_role: Database['public']['Enums']['member_role'] }
        Returns: number
      }
      /**
       * Resolves an email to a user and adds them to a project in one call.
       * Raises rather than returning a failure: 42501 when the caller is not an
       * admin of `p_project_id`, P0002 when no account uses the address, 23505
       * when they are already a member.
       */
      add_project_member_by_email: {
        Args: {
          p_project_id: string
          p_email: string
          p_role: Database['public']['Enums']['member_role']
        }
        Returns: string
      }
      /**
       * The same, resolving a Stellar address through `profiles.wallet_address`.
       * Adds 22023 to the raised set, for an argument that is not an address.
       */
      add_project_member_by_wallet: {
        Args: {
          p_project_id: string
          p_address: string
          p_role: Database['public']['Enums']['member_role']
        }
        Returns: string
      }
      /**
       * The same, resolving through `profiles.username`. Lowercases its
       * argument first, so a name typed the way a person capitalises it still
       * matches. 22023 for a name that could not be one.
       */
      add_project_member_by_username: {
        Args: {
          p_project_id: string
          p_username: string
          p_role: Database['public']['Enums']['member_role']
        }
        Returns: string
      }
      /**
       * The published view of one milestone, for callers with no account.
       * Returns null when the project does not publish, when the milestone does
       * not exist, and when the two do not belong together — an anonymous
       * caller must not be able to tell those apart.
       */
      public_milestone_proof: {
        Args: { p_slug: string; p_milestone_id: string }
        Returns: Json
      }
      /**
       * The node id of a published, linked milestone's doqtri heading, or
       * null (D-77). service_role only: the public page's server reads it to
       * know which DoqtriRegistry record to check (`lib/public-node.ts`).
       */
      public_milestone_node_id: {
        Args: { p_slug: string; p_milestone_id: string }
        Returns: string | null
      }
      /**
       * POST /api/v1/projects/{id}/docs. OAuth clients only (D-60: 42501 for
       * a qdit session), admin and above. Raises P0002 for a project the
       * caller is not in, 42501 below admin, 22023 with hint `doc_url` for a
       * URL off `integration_settings.doqtri_origin` once that is set (D-95),
       * and QD409 with message `doc_linked_elsewhere`. `created` is false on
       * a refresh.
       */
      link_project_doc: {
        Args: {
          p_project_id: string
          p_doc_id: string
          p_doc_title: string
          p_doc_url: string
        }
        Returns: {
          id: string
          project_id: string
          doc_id: string
          doc_title: string
          doc_url: string
          created_at: string
          updated_at: string
          created: boolean
        }[]
      }
      /**
       * DELETE /api/v1/projects/{id}/docs/{doc_id}. OAuth clients only (D-60),
       * admin and above. Returns the removed milestone link ids (D-22); P0002
       * when the doc is not linked. A qdit session unlinks by deleting the
       * `project_doc_links` row instead.
       */
      unlink_project_doc: {
        Args: { p_project_id: string; p_doc_id: string }
        Returns: string[]
      }
      /**
       * After the user revokes an app in Settings: records the revoke (D-59)
       * and marks the caller's own doc link connections through that client
       * lost. First-party sessions only; returns how many rows it marked.
       */
      mark_doc_link_connections_revoked: {
        Args: { p_client_id: string }
        Returns: number
      }
      /**
       * Before the user revokes an app in Settings: records that the caller
       * revoked `p_client_id` now, so /api/v1 refuses that app's tokens issued
       * until now (D-59). First-party sessions only; returns the revoke time.
       */
      record_oauth_client_revocation: {
        Args: { p_client_id: string }
        Returns: string
      }
      /**
       * Whether p_client_id is integration_settings.doqtri_oauth_client_id
       * (D-61); false while it is unset. Callable by any signed-in caller.
       */
      is_doqtri_oauth_client: {
        Args: { p_client_id: string }
        Returns: boolean
      }
      /**
       * Whether the caller's own OAuth token was issued at or before that
       * user's latest revoke of its client (D-59). Reads sub, client_id and
       * iat from the request JWT; called once per /api/v1 request.
       */
      oauth_token_revoked: {
        Args: Record<string, never>
        Returns: boolean
      }
      /**
       * POST /api/v1/milestones. Member and above. Returns the new milestone
       * id. QD409 `doc_not_linked` or `node_already_linked` (HINT = the
       * existing milestone id).
       */
      create_linked_milestone: {
        Args: {
          p_project_id: string
          p_title: string
          p_description: string | null
          p_due_date: string | null
          p_doc_id: string
          p_node_id: string
          p_doc_version: number | null
        }
        Returns: string
      }
      /**
       * Webhook delivery (service_role only). Claims up to `p_limit` due
       * events, at most one per (webhook, milestone) and only the head of
       * that queue (D-25); counts the attempt and leases the row.
       */
      claim_integration_events: {
        Args: { p_limit?: number; p_lease_seconds?: number }
        Returns: {
          id: string
          webhook_id: string
          milestone_id: string
          project_id: string
          event: 'milestone.status_changed'
          status: Database['public']['Enums']['milestone_status']
          occurred_at: string
          /** Including the attempt this claim is for. */
          attempts: number
          claim_token: string
          client_id: string
          target_url: string
          secret_ciphertext: string
          next_secret_ciphertext: string | null
        }[]
      }
      /**
       * Settles one claimed attempt. `p_next_attempt_at` null means dead; the
       * database also makes the 8th failure dead whatever is passed. Returns
       * `stale` when the claim token no longer matches.
       */
      record_integration_delivery: {
        Args: {
          p_id: string
          p_claim_token: string
          p_delivered: boolean
          p_error: string | null
          p_next_attempt_at: string | null
        }
        Returns: 'delivered' | 'retry' | 'dead' | 'stale'
      }
      /**
       * `integration_settings.doqtri_origin`, or null while unset
       * (service_role only, D-95): compared with `DOQTRI_ORIGIN` by
       * `lib/doqtri-origin-health.ts`.
       */
      doqtri_origin_setting: {
        Args: Record<string, never>
        Returns: string | null
      }
      /**
       * Whether the pg_cron delivery job can run (service_role only, D-57).
       * Secret names only, never values.
       */
      webhook_scheduler_health: {
        Args: Record<string, never>
        Returns: {
          status: 'configured' | 'missing' | 'unavailable'
          job: boolean
          missing_secrets: string[]
        }
      }
      /**
       * Whether the caller is staff of `p_hackathon_id` with at least
       * `p_min_role` (judge < admin). Used by the hackathon read policies.
       */
      is_hackathon_staff: {
        Args: { p_hackathon_id: string; p_min_role?: string }
        Returns: boolean
      }
      /**
       * Submit or resubmit a project's hackathon entry (first-party, project
       * admin+). Returns the new version id. Raises 42501 (OAuth token, role
       * below admin), P0002 (`No such hackathon.` / `No such project.`),
       * 22023 with hint `team_name` | `member_ids` | `image_paths`, QD409
       * `hackathon_not_open` | `hackathon_closed` | `member_on_other_team` |
       * `member_is_staff`, QD413 `snapshot_too_large` (still over 2 MB with
       * text clipped to 300 characters). Messages: 20261110100000_hackathons.sql.
       */
      /**
       * QDIT-55. What `submit_hackathon_entry` would freeze right now:
       * `{qdit_snapshot, doqtri_snapshot, doqtri_received_at,
       * doqtri_note_count}`. Writes nothing. Same session, role and window
       * checks (and error codes) as submit.
       */
      /** QDIT-56. Whether the caller is a qdit operator (first-party sessions only). */
      is_qdit_operator: {
        Args: Record<string, never>
        Returns: boolean
      }
      /** QDIT-56. Operators only; the caller becomes its admin. Returns the id. */
      create_hackathon: {
        Args: {
          p_slug: string
          p_name: string
          p_description: string | null
          p_opens_at: string
          p_closes_at: string
          p_team_min: number
          p_team_max: number
          p_finalist_count: number
          p_hidden: boolean
        }
        Returns: string
      }
      /**
       * QDIT-56. Operators or the hackathon's admins; replaces every field.
       * QD409 `slug_locked` | `released_locked`.
       */
      update_hackathon: {
        Args: {
          p_id: string
          p_slug: string
          p_name: string
          p_description: string | null
          p_opens_at: string
          p_closes_at: string
          p_team_min: number
          p_team_max: number
          p_finalist_count: number
          p_hidden: boolean
        }
        Returns: undefined
      }
      /** QDIT-56. Operators only; QD409 `hackathon_not_empty` with any entry or snapshot. */
      delete_hackathon: {
        Args: { p_id: string }
        Returns: undefined
      }
      /** QDIT-56. The hackathons the caller may manage, with counts and whether Delete is allowed. */
      hackathon_manage_list: {
        Args: Record<string, never>
        Returns: {
          id: string
          slug: string
          name: string
          description: string | null
          opens_at: string
          closes_at: string
          team_min: number
          team_max: number
          finalist_count: number
          hidden: boolean
          released_at: string | null
          entries: number
          snapshots: number
          can_delete: boolean
        }[]
      }
      /**
       * QDIT-60 (D-122). GET /api/v1/hackathons: listed hackathons (not hidden,
       * no `test-` slug) that have not closed, opens_at then slug, at most 50.
       * Any signed-in caller; 42501 for a revoked OAuth token.
       */
      list_open_hackathons_for_client: {
        Args: Record<string, never>
        Returns: {
          slug: string
          name: string
          opens_at: string
          closes_at: string
          state: string
        }[]
      }
      preview_hackathon_entry: {
        Args: {
          p_hackathon_id: string
          p_project_id: string
        }
        Returns: Json
      }
      submit_hackathon_entry: {
        Args: {
          p_hackathon_id: string
          p_project_id: string
          p_team_name: string
          p_member_ids: string[]
          p_image_paths: string[]
          /** QDIT-63. Required: null or blank is 22023, hint `slides_url`. */
          p_slides_url?: string
        }
        Returns: string
      }
      /**
       * POST /api/v1/projects/{id}/hackathon-snapshots (doqtri's OAuth client
       * only, project admin+). 42501 for a first-party session, another
       * client, a revoked token or a role below admin; P0002 for an unknown
       * project or slug; QD409 `snapshot_conflict` (also for the same key
       * to another hackathon) | `snapshot_limit` | `hackathon_not_open` |
       * `hackathon_closed`; QD413 `payload_too_large` over 3 MiB of jsonb text (a backstop: the route enforces 2 MiB on the raw body); 22023 for
       * bad arguments, `note_count` must equal the payload's notes.
       * A replay (same project, snapshot_id and hash) returns the first
       * answer with `replay: true`.
       */
      push_doqtri_hackathon_snapshot: {
        Args: {
          p_hackathon_slug: string
          p_project_id: string
          p_snapshot_id: string
          p_workspace_id: string
          p_payload: Json
          p_payload_sha256: string
          p_note_count: number
        }
        Returns: {
          id: string
          note_count: number
          received_at: string
          submission_state: 'none' | 'submitted_older' | 'current'
          replay: boolean
        }
      }
      /** service_role only. Stores the per-note registry check on a snapshot. */
      record_doqtri_chain_check: {
        Args: { p_snapshot_id: string; p_chain_check: Json }
        Returns: undefined
      }
      /**
       * Hackathon admin (first-party). Job states and eligibility per entry;
       * never scores, totals or flags (D-116).
       */
      hackathon_grading_status: {
        Args: { p_hackathon_id: string }
        Returns: {
          submission_id: string
          project_id: string
          project_slug: string
          team_name: string
          version_id: string | null
          version_no: number | null
          submitted_at: string | null
          /**
           * Live jobs. Before release only the first two, numbered 1 and 2;
           * after release all of them, with their real run_no.
           */
          jobs: {
            run_no: number
            status: 'pending' | 'running' | 'done' | 'failed'
            attempts: number
            free_attempts: number
            next_attempt_at: string
            last_error: string | null
            updated_at: string
          }[]
          /**
           * None of the jobs shown is pending or running: before release
           * only the first two count, so a third run leaves no trace.
           */
          complete: boolean
          eligibility: Json | null
          eligibility_override: boolean | null
          override_reason: string | null
          late_pass_until: string | null
        }[]
      }
      /**
       * Hackathon admin (first-party), after release only: QD409
       * `grades_not_released` before. `runs` are the counted runs (job done)
       * of the current version; `ai_criteria`/`ai_total` combine them exactly
       * as rubric.ts combineRuns.
       */
      hackathon_leaderboard: {
        Args: { p_hackathon_id: string }
        Returns: {
          submission_id: string
          project_id: string
          project_slug: string
          team_name: string
          version_id: string | null
          version_no: number | null
          submitted_at: string | null
          eligibility: Json | null
          eligibility_override: boolean | null
          override_reason: string | null
          eligible: boolean
          run_count: number | null
          runs: {
            run_no: number
            model: string
            total: number
            criteria: Json
            flags: string[]
            summary: string | null
            truncated: boolean
            created_at: string
          }[] | null
          /** Mean of the counted runs' stored totals, for display. */
          ai_mean: number | null
          /** Per criterion 0–10 as rubric.ts combineRuns: one run, mean of two, median of three. */
          ai_criteria: {
            clarity: number
            structure: number
            accuracy: number
            connections: number
            execution: number
          } | null
          /** Σ ai_criteria/10 × 20, 2 decimals. What release ranks by. */
          ai_total: number | null
          finalist: boolean
          ai_rank: number | null
          pitch_order: number | null
          judge_mean: number | null
          judge_count: number
          /** Every judge's scores as given (empty for a non-finalist), by judge_id. */
          judge_scores: {
            judge_id: string
            clarity: number
            structure: number
            accuracy: number
            connections: number
            pitch: number
          }[]
        }[]
      }
      /**
       * Hackathon admin (first-party). Irreversible. QD409
       * `already_released` | `hackathon_not_closed` | `late_pass_active` |
       * `grading_incomplete` (DETAIL `N entries still grading.`, counting
       * only entries whose first two live runs are unsettled: a pending third
       * run never holds release up, and the entry keeps its two-run mean).
       * Supersedes the hackathon's pending and running jobs. Returns the
       * finalist count.
       */
      release_hackathon_grades: {
        Args: { p_hackathon_id: string; p_allow_incomplete?: boolean }
        Returns: number
      }
      /** Hackathon admin, before release. A past `p_until` ends the pass. */
      grant_late_pass: {
        Args: { p_hackathon_id: string; p_project_id: string; p_until: string }
        Returns: undefined
      }
      /**
       * Hackathon admin, before release (QD409 `already_released` after).
       * Reason (1–500) required unless `p_value` is null. `true` on a
       * version the grader skipped (all live jobs done, no AI run) queues
       * two fresh runs.
       */
      set_eligibility_override: {
        Args: { p_submission_id: string; p_value: boolean | null; p_reason: string | null }
        Returns: undefined
      }
      /**
       * Hackathon admin. Adds, changes or (role null) removes a staff member
       * by username; QD409 `last_admin` | `staff_on_team`, P0002 for an
       * unknown username.
       * Returns their user id.
       */
      set_hackathon_staff: {
        Args: {
          p_hackathon_id: string
          p_username: string
          p_role: Database['public']['Enums']['hackathon_role'] | null
        }
        Returns: string
      }
      /**
       * Judge+ (first-party), after release (QD409 `grades_not_released`).
       * Finalists by pitch order, then submission id; never by AI rank.
       */
      hackathon_finals_for_judge: {
        Args: { p_hackathon_id: string }
        Returns: {
          submission_id: string
          team_name: string
          project_slug: string
          pitch_order: number | null
        }[]
      }
      /** Hackathon admin. The staff with username and display name. */
      hackathon_staff_list: {
        Args: { p_hackathon_id: string }
        Returns: {
          user_id: string
          username: string | null
          display_name: string | null
          role: Database['public']['Enums']['hackathon_role']
          created_at: string
        }[]
      }
      /** Hackathon admin, after release. A permutation of the finalists. */
      set_pitch_order: {
        Args: { p_hackathon_id: string; p_submission_ids: string[] }
        Returns: undefined
      }
      /**
       * Hackathon admin, before release. Supersedes the current version's
       * jobs and queues two runs with the next run numbers; QD409
       * `regrade_limit` past run 9. Returns the first new run_no.
       */
      regrade_submission: {
        Args: { p_submission_id: string }
        Returns: number
      }
      /**
       * Judge+ (first-party), after release, finalists only. QD409
       * `grades_not_released` | `not_finalist`; 22023 hint `scores` | `note`.
       */
      upsert_judge_score: {
        Args: {
          p_submission_id: string
          p_clarity: number
          p_structure: number
          p_accuracy: number
          p_connections: number
          p_pitch: number
          p_note: string | null
        }
        Returns: undefined
      }
      /**
       * Grader (service_role only). Leases up to `p_limit` due jobs, never
       * more than 20 running in total, with the frozen version they grade.
       */
      claim_grading_jobs: {
        Args: { p_limit?: number; p_lease_seconds?: number; p_version_id?: string | null }
        Returns: {
          job_id: string
          version_id: string
          run_no: number
          /**
           * Including the attempt this claim is for. Pass it back as
           * `p_attempt` to complete, fail or skip: any other value is stale.
           */
          attempts: number
          lease_until: string
          submission_id: string
          hackathon_id: string
          project_id: string
          team_name: string
          member_ids: string[]
          image_paths: string[]
          submitted_at: string
          qdit_snapshot: Json
          /** The frozen doqtri payload, or null. */
          doqtri_snapshot: Json | null
          opens_at: string
          closes_at: string
          team_min: number
          team_max: number
          /** The entry's current version; a claim for another is stale work. */
          current_version_id: string | null
          eligibility_override: boolean | null
          /** The version's stored eligibility result, or null. */
          eligibility: Json | null
        }[]
      }
      /**
       * Grader. Records the run and marks the job done; `stale` unless it is
       * still running under claim `p_attempt`.
       */
      complete_grading_job: {
        Args: {
          p_job_id: string
          p_attempt: number
          p_model: string
          p_criteria: Json
          p_total: number
          p_flags: string[]
          p_summary: string | null
          p_stop_reason: string | null
          p_usage: Json | null
          p_truncated: boolean
        }
        Returns: 'done' | 'stale'
      }
      /**
       * Grader. Back to pending while counted attempts < 3, else failed;
       * `p_permanent` (refusal, invalid output) fails it at once;
       * `p_count_attempt: false` (overload, budget abort) requeues it without
       * counting the attempt. `stale` unless running under claim `p_attempt`.
       */
      fail_grading_job: {
        Args: {
          p_job_id: string
          p_attempt: number
          p_error: string
          p_retry_after_seconds?: number
          p_permanent?: boolean
          p_count_attempt?: boolean
        }
        Returns: 'pending' | 'failed' | 'stale'
      }
      /**
       * Grader. Done with no AI run (an ineligible entry); reason in
       * last_error. `stale` unless running under claim `p_attempt`.
       */
      skip_grading_job: {
        Args: { p_job_id: string; p_attempt: number; p_reason: string }
        Returns: 'done' | 'stale'
      }
      /**
       * Grader. A version's live (not superseded) jobs and the runs of its
       * done jobs; P0002 for an unknown version.
       */
      hackathon_version_progress: {
        Args: { p_version_id: string }
        Returns: {
          version_id: string
          jobs: {
            id: string
            run_no: number
            status: 'pending' | 'running' | 'done' | 'failed'
          }[]
          runs: {
            run_no: number
            criteria: Json
            total: number
            flags: string[]
            model: string
          }[]
        }
      }
      /** Grader. The tie-break run; null when not needed or not current. */
      enqueue_third_run: {
        Args: { p_version_id: string }
        Returns: string | null
      }
      /** Grader. `p_eligibility` must carry a boolean `eligible`. */
      set_version_eligibility: {
        Args: { p_version_id: string; p_eligibility: Json }
        Returns: undefined
      }
      /** Whether the pg_cron grading job can run (service_role only). */
      hackathon_grading_scheduler_health: {
        Args: Record<string, never>
        Returns: {
          status: 'configured' | 'missing' | 'unavailable'
          job: boolean
          missing_secrets: string[]
        }
      }
    }

    Enums: {
      project_status: 'active' | 'paused' | 'completed' | 'archived'
      member_role: 'viewer' | 'member' | 'admin' | 'owner'
      milestone_status: 'proposed' | 'submitted' | 'approved' | 'rejected'
      task_status: 'todo' | 'in_progress' | 'done'
      /** Ordered low -> urgent; rendered P3..P0, most urgent first. */
      task_priority: 'low' | 'medium' | 'high' | 'urgent'
      stellar_network: 'testnet' | 'mainnet'
      deployment_status:
        | 'not_started'
        | 'testnet'
        | 'ready_for_mainnet'
        | 'mainnet_live'
      /** Named for the milestone_proof function the transaction invoked. */
      anchor_action: 'submit' | 'approve' | 'reject'
      /** Named for what happened, never for what the reader should do. */
      notification_kind:
        | 'milestone_submitted'
        | 'milestone_approved'
        | 'milestone_rejected'
      /** Hackathon staff (D-115): admin > judge. */
      hackathon_role: 'admin' | 'judge'
    }

    CompositeTypes: Record<string, never>
  }
}

/* -------------------------------------------------------------------------- */
/* Convenience aliases                                                        */
/* -------------------------------------------------------------------------- */

type PublicSchema = Database['public']
type TableName = keyof PublicSchema['Tables']

/** Row shape of any public table. `Tables<'tasks'>` === `Task`. */
export type Tables<T extends TableName> = PublicSchema['Tables'][T]['Row']
/** Insert payload for any public table. */
export type TablesInsert<T extends TableName> =
  PublicSchema['Tables'][T]['Insert']
/** Update payload for any public table. */
export type TablesUpdate<T extends TableName> =
  PublicSchema['Tables'][T]['Update']
/** Any public enum by name. `Enums<'task_status'>` === `TaskStatus`. */
export type Enums<T extends keyof PublicSchema['Enums']> =
  PublicSchema['Enums'][T]

// Rows
export type Profile = Tables<'profiles'>
export type Project = Tables<'projects'>
export type ProjectMember = Tables<'project_members'>
export type Milestone = Tables<'milestones'>
export type Task = Tables<'tasks'>
export type StellarProof = Tables<'stellar_proofs'>
export type Deployment = Tables<'deployments'>
export type ProjectDocLink = Tables<'project_doc_links'>
export type MilestoneExternalLink = Tables<'milestone_external_links'>

// Inserts
export type ProfileInsert = TablesInsert<'profiles'>
export type ProjectInsert = TablesInsert<'projects'>
export type ProjectMemberInsert = TablesInsert<'project_members'>
export type MilestoneInsert = TablesInsert<'milestones'>
export type TaskInsert = TablesInsert<'tasks'>
export type StellarProofInsert = TablesInsert<'stellar_proofs'>
export type DeploymentInsert = TablesInsert<'deployments'>

// Updates
export type ProfileUpdate = TablesUpdate<'profiles'>
export type ProjectUpdate = TablesUpdate<'projects'>
export type ProjectMemberUpdate = TablesUpdate<'project_members'>
export type MilestoneUpdate = TablesUpdate<'milestones'>
export type TaskUpdate = TablesUpdate<'tasks'>
export type StellarProofUpdate = TablesUpdate<'stellar_proofs'>
export type DeploymentUpdate = TablesUpdate<'deployments'>

// Enums
export type ProjectStatus = Enums<'project_status'>
export type MemberRole = Enums<'member_role'>
export type MilestoneStatus = Enums<'milestone_status'>
export type TaskStatus = Enums<'task_status'>
export type StellarNetwork = Enums<'stellar_network'>
export type DeploymentStatus = Enums<'deployment_status'>

/* -------------------------------------------------------------------------- */
/* Ordered enum values                                                        */
/*                                                                            */
/* Runtime companions to the types above, in the same order as the SQL enums, */
/* so UI can iterate board columns / filter dropdowns without re-declaring    */
/* the values. `satisfies` keeps them in lockstep with the types.             */
/* -------------------------------------------------------------------------- */

export const PROJECT_STATUSES = [
  'active',
  'paused',
  'completed',
  'archived',
] as const satisfies readonly ProjectStatus[]

export const MEMBER_ROLES = [
  'viewer',
  'member',
  'admin',
  'owner',
] as const satisfies readonly MemberRole[]

export const MILESTONE_STATUSES = [
  'proposed',
  'submitted',
  'approved',
  'rejected',
] as const satisfies readonly MilestoneStatus[]

/** Board column order: Todo -> In Progress -> Done. */
export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'done',
] as const satisfies readonly TaskStatus[]

export const STELLAR_NETWORKS = [
  'testnet',
  'mainnet',
] as const satisfies readonly StellarNetwork[]

/** Pipeline order: Not Started -> Testnet -> Ready for Mainnet -> Mainnet Live. */
export const DEPLOYMENT_STATUSES = [
  'not_started',
  'testnet',
  'ready_for_mainnet',
  'mainnet_live',
] as const satisfies readonly DeploymentStatus[]
