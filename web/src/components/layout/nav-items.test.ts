import { describe, expect, it } from "vitest";

import {
  FOOTER_NAV,
  HELP_NAV,
  WORKSPACE_NAV,
  isActive,
  mobileTabs,
  projectNav,
  type NavItem,
} from "@/components/layout/nav-items";

/**
 * The phone's tab bar and the rule that lights a nav item (QDIT-34).
 *
 * `mobileTabs` is primary navigation on a phone, so it is held to the bottom
 * navigation rules: at most five items counting More (the bar renders four of
 * these plus that button), every one labelled, top-level destinations only.
 * `isActive` is shared by the sidebar and the tab bar, which is the point —
 * the two can no longer disagree about where you are.
 */

const SLUG = "milestone-proof-registry";

const item = (href: string, exact = false): NavItem => ({
  href,
  label: href,
  icon: () => null,
  exact,
});

describe("mobileTabs", () => {
  it("offers the workspace loop outside a project", () => {
    const tabs = mobileTabs(undefined);

    expect(tabs.map((tab) => [tab.label, tab.href])).toEqual([
      ["Dashboard", "/dashboard"],
      ["Projects", "/projects"],
      ["Tasks", "/tasks"],
      ["Milestones", "/milestones"],
    ]);
  });

  it("follows the project scope once one is open", () => {
    const tabs = mobileTabs(SLUG);

    expect(tabs.map((tab) => [tab.label, tab.href])).toEqual([
      ["Overview", `/projects/${SLUG}`],
      ["Board", `/projects/${SLUG}/board`],
      ["Milestones", `/projects/${SLUG}/milestones`],
      ["Proofs", `/projects/${SLUG}/proofs`],
    ]);
  });

  it("treats an empty slug as no project", () => {
    expect(mobileTabs("")).toEqual(mobileTabs(undefined));
  });

  it.each([
    ["workspace", undefined],
    ["project", SLUG],
  ])("leaves room for More within five items (%s scope)", (_scope, slug) => {
    // Four tabs + the More button the bar adds = Material's five-item ceiling.
    expect(mobileTabs(slug).length + 1).toBeLessThanOrEqual(5);
  });

  it.each([
    ["workspace", undefined],
    ["project", SLUG],
  ])("labels every tab with one short word and an icon (%s scope)", (_scope, slug) => {
    for (const tab of mobileTabs(slug)) {
      expect(tab.label).toMatch(/^\S+$/);
      expect(tab.label.length).toBeLessThanOrEqual(10);
      expect(typeof tab.icon === "function" || typeof tab.icon === "object").toBe(true);
    }
  });

  it.each([
    ["workspace", undefined],
    ["project", SLUG],
  ])("has no two tabs pointing at the same place (%s scope)", (_scope, slug) => {
    const hrefs = mobileTabs(slug).map((tab) => tab.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("only offers destinations the sidebar also has, so More is never the only way back", () => {
    const sidebar = new Set(
      [...WORKSPACE_NAV, ...FOOTER_NAV, ...projectNav(SLUG)].map((entry) => entry.href),
    );
    for (const tab of [...mobileTabs(undefined), ...mobileTabs(SLUG)]) {
      expect(sidebar.has(tab.href)).toBe(true);
    }
  });

  it("keeps the exactness of the matching sidebar entry", () => {
    // A tab that lit up where the sidebar did not would put two "you are
    // here" marks on screen.
    const sidebar = new Map(
      [...WORKSPACE_NAV, ...projectNav(SLUG)].map((entry) => [entry.href, Boolean(entry.exact)]),
    );
    for (const tab of [...mobileTabs(undefined), ...mobileTabs(SLUG)]) {
      expect(Boolean(tab.exact)).toBe(sidebar.get(tab.href));
    }
  });
});

describe("HELP_NAV", () => {
  it("links the user guide and the API docs", () => {
    expect(HELP_NAV.map((entry) => [entry.label, entry.href])).toEqual([
      ["User guide", "/user-guide"],
      ["API docs", "/docs"],
    ]);
  });
});

describe("isActive", () => {
  it("matches its own path", () => {
    expect(isActive("/tasks", item("/tasks"))).toBe(true);
  });

  it("lights a parent for its descendants by default", () => {
    expect(isActive(`/projects/${SLUG}/board`, item(`/projects/${SLUG}/board`))).toBe(true);
    expect(
      isActive(`/projects/${SLUG}/milestones/abc`, item(`/projects/${SLUG}/milestones`)),
    ).toBe(true);
  });

  it("does not light a sibling that merely shares a prefix", () => {
    // `/tasks-archive` starts with `/tasks` but is not under it.
    expect(isActive("/tasks-archive", item("/tasks"))).toBe(false);
    expect(isActive("/projectsx", item("/projects"))).toBe(false);
  });

  it("matches only the exact path when `exact` is set", () => {
    const overview = item(`/projects/${SLUG}`, true);

    expect(isActive(`/projects/${SLUG}`, overview)).toBe(true);
    expect(isActive(`/projects/${SLUG}/board`, overview)).toBe(false);
    expect(isActive(`/projects/${SLUG}/milestones/abc`, overview)).toBe(false);
  });

  it("keeps the Projects index dark inside a project", () => {
    const projects = WORKSPACE_NAV.find((entry) => entry.href === "/projects")!;

    expect(isActive("/projects", projects)).toBe(true);
    expect(isActive(`/projects/${SLUG}`, projects)).toBe(false);
  });

  it.each([
    ["/dashboard", "Dashboard"],
    ["/projects", "Projects"],
    ["/tasks", "Tasks"],
    ["/milestones", "Milestones"],
  ])("lights exactly one workspace tab on %s", (pathname, label) => {
    const active = mobileTabs(undefined).filter((tab) => isActive(pathname, tab));
    expect(active.map((tab) => tab.label)).toEqual([label]);
  });

  it.each([
    [`/projects/${SLUG}`, "Overview"],
    [`/projects/${SLUG}/board`, "Board"],
    [`/projects/${SLUG}/milestones`, "Milestones"],
    [`/projects/${SLUG}/milestones/bbbbbbbb-0000-4000-8000-000000000001`, "Milestones"],
    [`/projects/${SLUG}/proofs`, "Proofs"],
  ])("lights exactly one project tab on %s", (pathname, label) => {
    const active = mobileTabs(SLUG).filter((tab) => isActive(pathname, tab));
    expect(active.map((tab) => tab.label)).toEqual([label]);
  });

  it.each([`/projects/${SLUG}/deployments`, `/projects/${SLUG}/members`])(
    "lights no tab on %s, which lives under More",
    (pathname) => {
      expect(mobileTabs(SLUG).filter((tab) => isActive(pathname, tab))).toEqual([]);
    },
  );
});
