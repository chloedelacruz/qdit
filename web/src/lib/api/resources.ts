import type { Tables } from "@/lib/types/database";

/**
 * Response shapes for `/api/v1` — integration contract section 7.
 *
 * These are the wire format another app depends on, so they are spelled out
 * field by field rather than spread from a row: a new column on `projects`
 * must not appear in the API because somebody added it to a `select`. Within
 * v1 fields may be added here, never removed, renamed or retyped (section 3).
 * Optional fields are `null`, never omitted (section 4).
 */

export type ApiProject = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: Tables<"projects">["status"];
  role: Tables<"project_members">["role"];
  chain: { network: "testnet" | "mainnet"; contract_id: string } | null;
  url: string;
  created_at: string;
  updated_at: string;
};

export type ApiUser = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
};

export type ProjectRow = Pick<
  Tables<"projects">,
  | "id"
  | "name"
  | "slug"
  | "description"
  | "status"
  | "chain_network"
  | "chain_contract_id"
  | "created_at"
  | "updated_at"
>;

/** The columns `toProject()` reads, as a PostgREST select list. */
export const PROJECT_COLUMNS =
  "id, name, slug, description, status, chain_network, chain_contract_id, created_at, updated_at";

/**
 * An absolute qdit page URL. The contract leaves the path to qdit (section 7);
 * the origin is `NEXT_PUBLIC_SITE_URL`, `https://qdit.atalusan.com` in
 * production.
 */
export function qditUrl(path: string): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://127.0.0.1:3000";
  return new URL(path, site).toString();
}

export function toProject(
  row: ProjectRow,
  role: Tables<"project_members">["role"],
): ApiProject {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    role,
    // The table's CHECK keeps the two columns null together or set together;
    // both are tested anyway so a half-registered row reads as unregistered.
    chain:
      row.chain_network && row.chain_contract_id
        ? { network: row.chain_network, contract_id: row.chain_contract_id }
        : null,
    url: qditUrl(`/projects/${encodeURIComponent(row.slug)}`),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
