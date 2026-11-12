import { afterEach, describe, expect, it, vi } from "vitest";

import { mindmapLink } from "./mindmap-link";

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
