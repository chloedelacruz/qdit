/**
 * Shared fixtures for the `/api/v1` route tests: ids from the contract's
 * examples, a request builder, and database rows in the shapes the routes
 * select. Rows are what PostgREST would return, not what the API sends.
 */

export const USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";
export const PROJECT = "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34";
export const MILESTONE = "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61";
export const LINK = "0e9d4c3b-2a1f-4e5d-8c7b-6a5f4e3d2c1b";
export const DOC = "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f";
export const DOC_LINK = "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
export const CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";

export function apiRequest(
  path: string,
  init: { method?: string; body?: unknown; raw?: string; contentType?: string | null } = {},
): Request {
  const headers: Record<string, string> = { authorization: "Bearer a.b.c" };
  const hasBody = init.body !== undefined || init.raw !== undefined;
  if (hasBody && init.contentType !== null) {
    headers["content-type"] = init.contentType ?? "application/json; charset=utf-8";
  }
  return new Request(`https://qdit.test/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
}

export const params = <T extends Record<string, string>>(value: T) => ({
  params: Promise.resolve(value),
});

export function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK,
    doc_id: DOC,
    node_id: "h4",
    node_label: "Escrow contract",
    doc_version: 7,
    created_at: "2026-10-20T14:02:11+00:00",
    updated_at: "2026-10-20T14:02:11+00:00",
    ...overrides,
  };
}

export function anchorRow(overrides: Record<string, unknown> = {}) {
  return {
    network: "testnet",
    contract_id: CONTRACT,
    version: 1,
    action: "submit",
    proof_hash: "a".repeat(64),
    tx_hash: "b".repeat(64),
    created_at: "2026-10-21T08:00:00+00:00",
    ...overrides,
  };
}

export function milestoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MILESTONE,
    title: "Escrow contract",
    description: null,
    status: "submitted",
    due_date: "2026-11-15",
    order_index: 3,
    created_at: "2026-10-20T14:02:11+00:00",
    updated_at: "2026-10-22T08:11:40+00:00",
    project: { id: PROJECT, name: "Soroban payroll", slug: "soroban-payroll" },
    link: linkRow(),
    anchors: [],
    ...overrides,
  };
}

/** The contract's Milestone for `milestoneRow()` with no anchors. */
export function expectedMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: MILESTONE,
    project: { id: PROJECT, name: "Soroban payroll", slug: "soroban-payroll" },
    title: "Escrow contract",
    description: null,
    status: "submitted",
    due_date: "2026-11-15",
    order_index: 3,
    url: "https://qdit.app/projects/soroban-payroll/milestones",
    link: {
      id: LINK,
      doc_id: DOC,
      node_id: "h4",
      node_label: "Escrow contract",
      doc_version: 7,
      created_at: "2026-10-20T14:02:11+00:00",
      updated_at: "2026-10-20T14:02:11+00:00",
    },
    anchor: null,
    created_at: "2026-10-20T14:02:11+00:00",
    updated_at: "2026-10-22T08:11:40+00:00",
    ...overrides,
  };
}

export const MILESTONE_KEYS = [
  "anchor",
  "created_at",
  "description",
  "due_date",
  "id",
  "link",
  "order_index",
  "project",
  "status",
  "title",
  "updated_at",
  "url",
];
