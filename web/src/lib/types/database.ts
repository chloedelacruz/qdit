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
          wallet_address: string | null
          created_at: string
        }
        Insert: {
          /** Must equal auth.uid(); normally written by the on_auth_user_created trigger. */
          id: string
          display_name?: string | null
          avatar_url?: string | null
          wallet_address?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string | null
          avatar_url?: string | null
          wallet_address?: string | null
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
    }

    Enums: {
      project_status: 'active' | 'paused' | 'completed' | 'archived'
      member_role: 'viewer' | 'member' | 'admin' | 'owner'
      milestone_status: 'proposed' | 'submitted' | 'approved' | 'rejected'
      task_status: 'todo' | 'in_progress' | 'done'
      stellar_network: 'testnet' | 'mainnet'
      deployment_status:
        | 'not_started'
        | 'testnet'
        | 'ready_for_mainnet'
        | 'mainnet_live'
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
