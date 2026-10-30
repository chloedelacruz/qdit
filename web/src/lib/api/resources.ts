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

/** The contract's production origin (section 7). */
const PRODUCTION_ORIGIN = "https://qdit.app";

let warnedMissingSite = false;

/**
 * An absolute qdit page URL. The contract leaves the path to qdit (section 7);
 * the origin is `NEXT_PUBLIC_SITE_URL`.
 *
 * Unset, the fallback is localhost only outside production. In production
 * it is the contract's origin, said once in the log: a `url` pointing at
 * 127.0.0.1 would reach doqtri users as a dead link and nothing would flag it.
 */
export function qditUrl(path: string): string {
  let site = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (!site) {
    if (process.env.NODE_ENV === "production") {
      if (!warnedMissingSite) {
        warnedMissingSite = true;
        console.error(
          `api: NEXT_PUBLIC_SITE_URL is not set; using ${PRODUCTION_ORIGIN} for API urls. See web/.env.example.`,
        );
      }
      site = PRODUCTION_ORIGIN;
    } else {
      site = "http://127.0.0.1:3000";
    }
  }

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

/** `link` on a Milestone (section 7): the milestone_external_links row. */
export type ApiMilestoneLink = {
  id: string;
  doc_id: string;
  node_id: string;
  node_label: string;
  doc_version: number | null;
  created_at: string;
  updated_at: string;
};

/** `anchor` on a Milestone (section 7, D-32): a summary of milestone_anchors. */
export type ApiAnchor = {
  network: Tables<"milestone_anchors">["network"];
  contract_id: string;
  version: number;
  proof_hash: string | null;
  last_action: Tables<"milestone_anchors">["action"];
  last_tx_hash: string;
  anchored_at: string;
};

export type ApiMilestone = {
  id: string;
  project: { id: string; name: string; slug: string };
  title: string;
  description: string | null;
  status: Tables<"milestones">["status"];
  due_date: string | null;
  order_index: number;
  url: string;
  link: ApiMilestoneLink | null;
  anchor: ApiAnchor | null;
  created_at: string;
  updated_at: string;
};

export type ApiDocLink = {
  id: string;
  project_id: string;
  doc_id: string;
  doc_title: string;
  doc_url: string;
  created_at: string;
  updated_at: string;
};

type AnchorRow = Pick<
  Tables<"milestone_anchors">,
  "network" | "contract_id" | "version" | "action" | "proof_hash" | "tx_hash" | "created_at"
>;

type LinkRow = Pick<
  Tables<"milestone_external_links">,
  "id" | "doc_id" | "node_id" | "node_label" | "doc_version" | "created_at" | "updated_at"
>;

/**
 * What `toMilestone()` reads. `link` is a one-to-one embed (milestone_id is
 * unique), which PostgREST returns as an object or null; an array is accepted
 * too, so a change in how the relationship is detected cannot drop the link.
 */
export type MilestoneResourceRow = Pick<
  Tables<"milestones">,
  | "id"
  | "title"
  | "description"
  | "status"
  | "due_date"
  | "order_index"
  | "created_at"
  | "updated_at"
> & {
  project: { id: string; name: string; slug: string } | null;
  link: LinkRow | LinkRow[] | null;
  anchors: AnchorRow[] | null;
};

/** The select list `toMilestone()` reads, as one PostgREST request. */
export const MILESTONE_RESOURCE_COLUMNS = [
  "id, title, description, status, due_date, order_index, created_at, updated_at",
  "project:projects!inner(id, name, slug)",
  "link:milestone_external_links(id, doc_id, node_id, node_label, doc_version, created_at, updated_at)",
  "anchors:milestone_anchors(network, contract_id, version, action, proof_hash, tx_hash, created_at)",
].join(", ");

/**
 * Newest first, as the contract defines "newest" (section 7): highest
 * `version`, then latest `created_at`. Rows are recorded by clients after the
 * transaction, so arrival order is not chain order.
 */
function newestFirst(a: AnchorRow, b: AnchorRow): number {
  if (a.version !== b.version) return b.version - a.version;
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (at !== bt) return bt - at;
  // Same millisecond: Postgres prints microseconds, and for one column the
  // strings compare in time order.
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

export function toAnchor(rows: readonly AnchorRow[]): ApiAnchor | null {
  const ordered = [...rows].sort(newestFirst);
  const newest = ordered[0];
  if (!newest) return null;

  // Only `submit` carries a hash; approve and reject attest to the one on chain.
  const submitted = ordered.find((row) => row.action === "submit");

  return {
    network: newest.network,
    contract_id: newest.contract_id,
    version: newest.version,
    proof_hash: submitted?.proof_hash ?? null,
    last_action: newest.action,
    last_tx_hash: newest.tx_hash,
    anchored_at: newest.created_at,
  };
}

export function toMilestone(row: MilestoneResourceRow): ApiMilestone {
  const link = Array.isArray(row.link) ? (row.link[0] ?? null) : row.link;
  const project = row.project ?? { id: "", name: "", slug: "" };

  return {
    id: row.id,
    project: { id: project.id, name: project.name, slug: project.slug },
    title: row.title,
    description: row.description,
    status: row.status,
    due_date: row.due_date,
    order_index: row.order_index,
    url: qditUrl(`/projects/${encodeURIComponent(project.slug)}/milestones`),
    link: link
      ? {
          id: link.id,
          doc_id: link.doc_id,
          node_id: link.node_id,
          node_label: link.node_label,
          doc_version: link.doc_version,
          created_at: link.created_at,
          updated_at: link.updated_at,
        }
      : null,
    anchor: toAnchor(row.anchors ?? []),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toDocLink(
  row: Pick<
    Tables<"project_doc_links">,
    "id" | "project_id" | "doc_id" | "doc_title" | "doc_url" | "created_at" | "updated_at"
  >,
): ApiDocLink {
  return {
    id: row.id,
    project_id: row.project_id,
    doc_id: row.doc_id,
    doc_title: row.doc_title,
    doc_url: row.doc_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
