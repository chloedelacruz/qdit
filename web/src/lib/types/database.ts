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
        /** Admins in a qdit session only; apps refresh through `link_project_doc`. */
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
       * (20261025120600_doc_link_connections.sql). Project viewers read it;
       * apps see nothing. Written only by triggers and
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
       * POST /api/v1/projects/{id}/docs. Admin and above. Raises P0002 for a
       * project the caller is not in, 42501 below admin, and QD409 with
       * message `doc_linked_elsewhere`. `created` is false on a refresh.
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
       * DELETE /api/v1/projects/{id}/docs/{doc_id}. Admin and above. Returns
       * the removed milestone link ids (D-22); P0002 when the doc is not linked.
       */
      unlink_project_doc: {
        Args: { p_project_id: string; p_doc_id: string }
        Returns: string[]
      }
      /**
       * After the user revokes an app in Settings: marks the caller's own doc
       * link connections through that client lost. First-party sessions only;
       * returns how many rows it marked.
       */
      mark_doc_link_connections_revoked: {
        Args: { p_client_id: string }
        Returns: number
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
