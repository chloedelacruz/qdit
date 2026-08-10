/**
 * Typed URL state for every filterable list in the app.
 *
 * Filters live in the query string rather than component state so a filtered
 * view is shareable, bookmarkable and survives a refresh — and so the back
 * button does what the user expects. Multi-value facets are comma-separated
 * (`?status=todo,in_progress`) because repeated keys read badly when pasted
 * into Slack, which is where these URLs actually end up.
 */

/** Matches the `searchParams` prop shape — a Promise of this in Next 16. */
export type SearchParams = { [key: string]: string | string[] | undefined };

export const SORT_KEYS = ["updated", "name", "progress", "due", "priority"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  updated: "Last updated",
  name: "Name",
  progress: "Progress",
  due: "Due date",
  priority: "Priority",
};

export type Filters = {
  /** Free-text query. Also matches contract IDs and tx hashes. */
  q: string;
  status: string[];
  /** `tasks.priority`. Tasks are the only entity that has one. */
  priority: string[];
  assignee: string[];
  milestone: string[];
  network: string[];
  project: string[];
  sort: SortKey;
  /** Rows to render. Progressive disclosure — "Load more" raises it. */
  limit: number;
};

export const DEFAULT_LIMIT = 25;

export const EMPTY_FILTERS: Filters = {
  q: "",
  status: [],
  priority: [],
  assignee: [],
  milestone: [],
  network: [],
  project: [],
  sort: "updated",
  limit: DEFAULT_LIMIT,
};

/** Facet keys, i.e. everything that renders as a multi-select in the bar. */
export const FACET_KEYS = [
  "status",
  "priority",
  "assignee",
  "milestone",
  "network",
  "project",
] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

function readOne(params: SearchParams, key: string): string {
  const value = params[key];
  // A repeated key yields an array; take the first so a hand-edited URL still
  // resolves rather than rendering "a,b" as a single nonsense token.
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function readList(params: SearchParams, key: string): string[] {
  const raw = readOne(params, key);
  if (!raw) return [];
  return [...new Set(raw.split(",").map((part) => part.trim()).filter(Boolean))];
}

export function parseFilters(params: SearchParams): Filters {
  const sort = readOne(params, "sort") as SortKey;
  const limit = Number.parseInt(readOne(params, "limit"), 10);

  return {
    q: readOne(params, "q"),
    status: readList(params, "status"),
    priority: readList(params, "priority"),
    assignee: readList(params, "assignee"),
    milestone: readList(params, "milestone"),
    network: readList(params, "network"),
    project: readList(params, "project"),
    sort: SORT_KEYS.includes(sort) ? sort : "updated",
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : DEFAULT_LIMIT,
  };
}

/**
 * Serialises back to a query string, omitting anything at its default so URLs
 * stay short and a cleared filter bar returns to a bare path.
 */
export function serialiseFilters(filters: Filters): string {
  const params = new URLSearchParams();

  if (filters.q) params.set("q", filters.q);
  for (const key of FACET_KEYS) {
    if (filters[key].length > 0) params.set(key, filters[key].join(","));
  }
  if (filters.sort !== "updated") params.set("sort", filters.sort);
  if (filters.limit !== DEFAULT_LIMIT) params.set("limit", String(filters.limit));

  return params.toString();
}

/** Adds or removes one value from a facet, returning a new Filters. */
export function toggleFacet(filters: Filters, key: FacetKey, value: string): Filters {
  const current = filters[key];
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];

  // Changing a filter invalidates however far the user had paged in.
  return { ...filters, [key]: next, limit: DEFAULT_LIMIT };
}

export function clearFilters(filters: Filters): Filters {
  return { ...EMPTY_FILTERS, sort: filters.sort };
}

/** True when anything is narrowing the result set — drives the Clear button. */
export function hasActiveFilters(filters: Filters): boolean {
  return (
    filters.q.length > 0 || FACET_KEYS.some((key) => filters[key].length > 0)
  );
}

export function activeFilterCount(filters: Filters): number {
  return (
    FACET_KEYS.reduce((sum, key) => sum + filters[key].length, 0) +
    (filters.q ? 1 : 0)
  );
}
