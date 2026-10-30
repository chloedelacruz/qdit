import { afterEach, describe, expect, it, vi } from "vitest";

import { qditUrl } from "./resources";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("qditUrl", () => {
  it("uses NEXT_PUBLIC_SITE_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qdit.example");
    expect(qditUrl("/projects/a")).toBe("https://qdit.example/projects/a");
  });

  it("falls back to localhost outside production", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(qditUrl("/projects/a")).toBe("http://127.0.0.1:3000/projects/a");
  });

  it("falls back to the contract's origin in production, and says so once", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(qditUrl("/projects/a")).toBe("https://qdit.app/projects/a");
    expect(qditUrl("/projects/b")).toBe("https://qdit.app/projects/b");
    expect(log).toHaveBeenCalledTimes(1);
  });
});
