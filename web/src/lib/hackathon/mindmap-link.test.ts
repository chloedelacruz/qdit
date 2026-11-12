import { afterEach, describe, expect, it, vi } from "vitest";

import { MINDMAP_LINK_STATUS_LABEL, mindmapLink, mindmapLinkView } from "./mindmap-link";

/** Which stored Mindmap links the team card, the staff page and the export show (QDIT-66). */
describe("mindmapLink", () => {
  const LINK = "https://www.doqtri.xyz/m/Ab3_-xYz0123456789AbCd";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a link on DOQTRI_ORIGIN (the default when unset)", () => {
    expect(mindmapLink(LINK, undefined)).toBe(LINK);
    expect(mindmapLink(LINK, "https://www.doqtri.xyz")).toBe(LINK);
  });

  it("shows nothing for no link", () => {
    expect(mindmapLink(null, undefined)).toBeNull();
    expect(mindmapLink("", undefined)).toBeNull();
    expect(mindmapLink(undefined, undefined)).toBeNull();
  });

  it("shows nothing for a stored link off the configured origin", () => {
    expect(mindmapLink("https://evil.example/m/Ab3_-xYz0123456789AbCd", undefined)).toBeNull();
    expect(mindmapLink(LINK, "https://staging.doqtri.xyz")).toBeNull();
  });

  it("shows nothing, and logs, when DOQTRI_ORIGIN is misconfigured", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(mindmapLink(LINK, "https://www.doqtri.xyz/path")).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

/** What the team card and the staff page render (QDIT-67). */
describe("mindmapLinkView", () => {
  const LINK = "https://www.doqtri.xyz/m/Ab3_-xYz0123456789AbCd";

  it("shows Open mindmap while the link is live or its status unknown", () => {
    expect(mindmapLinkView(LINK, "live", undefined)).toEqual({ kind: "link", url: LINK });
    expect(mindmapLinkView(LINK, "unknown", undefined)).toEqual({ kind: "link", url: LINK });
  });

  it("shows the revoked-or-expired line, with no link, once doqtri says it is dead", () => {
    expect(mindmapLinkView(LINK, "dead", undefined)).toEqual({ kind: "dead" });
  });

  it("shows nothing for no link, or one off DOQTRI_ORIGIN, whatever the status", () => {
    expect(mindmapLinkView(null, "dead", undefined)).toEqual({ kind: "none" });
    expect(mindmapLinkView("https://evil.example/m/Ab3_-xYz0123456789AbCd", "live", undefined)).toEqual({ kind: "none" });
  });

  it("labels the export column", () => {
    expect(MINDMAP_LINK_STATUS_LABEL).toEqual({ live: "Live", dead: "Revoked or expired", unknown: "Unknown" });
  });
});
