import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMIT,
  EMPTY_FILTERS,
  activeFilterCount,
  clearFilters,
  hasActiveFilters,
  parseFilters,
  serialiseFilters,
  toggleFacet,
  type Filters,
} from "@/lib/filters";

/**
 * Filter state lives in the URL so a filtered view is shareable and the back
 * button works. That only holds if `parseFilters` and `serialiseFilters` are
 * exact inverses, which is the sort of property that breaks silently — nothing
 * throws when a facet stops round-tripping, the list just quietly shows the
 * wrong rows. Hence testing the pair together rather than each alone.
 */

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...EMPTY_FILTERS, ...overrides };
}

/** The round trip the whole module exists to make reliable. */
function roundTrip(input: Filters): Filters {
  return parseFilters(Object.fromEntries(new URLSearchParams(serialiseFilters(input))));
}

describe("parseFilters", () => {
  it("returns the defaults for an empty query string", () => {
    expect(parseFilters({})).toEqual(EMPTY_FILTERS);
  });

  it("splits a comma-separated facet", () => {
    expect(parseFilters({ status: "todo,in_progress" }).status).toEqual([
      "todo",
      "in_progress",
    ]);
  });

  it("trims whitespace and drops empty segments", () => {
    // `?status=todo,,%20done%20` — the shape a hand-edited URL actually takes.
    expect(parseFilters({ status: "todo,, done " }).status).toEqual(["todo", "done"]);
  });

  it("de-duplicates repeated values within a facet", () => {
    expect(parseFilters({ network: "testnet,testnet,mainnet" }).network).toEqual([
      "testnet",
      "mainnet",
    ]);
  });

  it("takes the first value when a key is repeated", () => {
    // Next gives an array for `?q=a&q=b`. Joining would render "a,b" as one
    // nonsense token, so the first wins.
    expect(parseFilters({ q: ["first", "second"] }).q).toBe("first");
  });

  it("falls back to the default sort when the key is unknown", () => {
    expect(parseFilters({ sort: "wharever" }).sort).toBe("updated");
  });

  it("accepts a known sort key", () => {
    expect(parseFilters({ sort: "progress" }).sort).toBe("progress");
  });

  it("reads the priority facet, which only the task surfaces offer", () => {
    // The values are the `task_priority` enum's own, so what the URL carries is
    // what `listTasks` hands to Postgres' `in`.
    expect(parseFilters({ priority: "urgent,high" }).priority).toEqual([
      "urgent",
      "high",
    ]);
  });

  describe("limit", () => {
    it("defaults when absent, unparseable, zero or negative", () => {
      for (const limit of [undefined, "abc", "0", "-5", ""]) {
        expect(parseFilters(limit === undefined ? {} : { limit }).limit).toBe(
          DEFAULT_LIMIT,
        );
      }
    });

    it("caps at 500, so a hand-edited URL cannot ask for everything", () => {
      expect(parseFilters({ limit: "99999" }).limit).toBe(500);
    });

    it("keeps a sensible value", () => {
      expect(parseFilters({ limit: "50" }).limit).toBe(50);
    });
  });
});

describe("serialiseFilters", () => {
  it("omits everything at its default, so a cleared bar gives a bare path", () => {
    expect(serialiseFilters(EMPTY_FILTERS)).toBe("");
  });

  it("omits the default sort and the default limit", () => {
    expect(serialiseFilters(filters({ sort: "updated", limit: DEFAULT_LIMIT }))).toBe("");
  });

  it("writes a non-default limit, which is what the board's Load more does", () => {
    expect(serialiseFilters(filters({ limit: 50 }))).toBe("limit=50");
  });

  it("joins a facet with commas rather than repeating the key", () => {
    // Repeated keys read badly when pasted into Slack, which is where these
    // URLs end up.
    expect(serialiseFilters(filters({ status: ["todo", "done"] }))).toBe(
      "status=todo%2Cdone",
    );
  });
});

describe("round trip", () => {
  it("preserves a fully populated filter set", () => {
    const input = filters({
      q: "contract",
      status: ["todo", "in_progress"],
      priority: ["urgent", "high"],
      assignee: ["11111111-1111-1111-1111-111111111111"],
      milestone: ["22222222-2222-2222-2222-222222222222"],
      network: ["testnet"],
      project: ["33333333-3333-3333-3333-333333333333"],
      sort: "due",
      limit: 100,
    });

    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves the defaults through an empty query string", () => {
    expect(roundTrip(EMPTY_FILTERS)).toEqual(EMPTY_FILTERS);
  });

  it("survives a query containing characters that need encoding", () => {
    const input = filters({ q: "a b&c=d,e" });
    expect(roundTrip(input)).toEqual(input);
  });
});

describe("toggleFacet", () => {
  it("adds a value that is not present", () => {
    expect(toggleFacet(EMPTY_FILTERS, "status", "todo").status).toEqual(["todo"]);
  });

  it("removes a value that is present", () => {
    const start = filters({ status: ["todo", "done"] });
    expect(toggleFacet(start, "status", "todo").status).toEqual(["done"]);
  });

  it("resets the limit, because narrowing invalidates how far you had paged", () => {
    const start = filters({ limit: 200 });
    expect(toggleFacet(start, "status", "todo").limit).toBe(DEFAULT_LIMIT);
  });

  it("does not mutate the input", () => {
    const start = filters({ status: ["todo"] });
    toggleFacet(start, "status", "done");
    expect(start.status).toEqual(["todo"]);
  });

  it("leaves other facets alone", () => {
    const start = filters({ status: ["todo"], network: ["testnet"] });
    expect(toggleFacet(start, "status", "done").network).toEqual(["testnet"]);
  });
});

describe("clearFilters", () => {
  it("keeps the sort and drops everything else", () => {
    // Sort is a display preference rather than a filter, so clearing the bar
    // should not reorder the list under the user.
    const start = filters({ q: "x", status: ["todo"], sort: "name", limit: 100 });
    expect(clearFilters(start)).toEqual({ ...EMPTY_FILTERS, sort: "name" });
  });
});

describe("hasActiveFilters", () => {
  it("is false for the defaults", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("is true for a query or any facet", () => {
    expect(hasActiveFilters(filters({ q: "x" }))).toBe(true);
    expect(hasActiveFilters(filters({ network: ["testnet"] }))).toBe(true);
  });

  it("ignores sort and limit, which narrow nothing", () => {
    expect(hasActiveFilters(filters({ sort: "name", limit: 500 }))).toBe(false);
  });
});

describe("activeFilterCount", () => {
  it("counts each facet value, plus the query as one", () => {
    const start = filters({ q: "x", status: ["todo", "done"], network: ["testnet"] });
    expect(activeFilterCount(start)).toBe(4);
  });

  it("counts priority too, so the Clear button's number stays honest", () => {
    // Every facet has to be in FACET_KEYS for this to hold — a facet that
    // filters but is not counted leaves the bar understating what it hid.
    expect(activeFilterCount(filters({ priority: ["urgent"] }))).toBe(1);
    expect(hasActiveFilters(filters({ priority: ["urgent"] }))).toBe(true);
  });

  it("is zero for the defaults", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });
});
