import { describe, expect, it } from "vitest";

import { isBearerApiPath } from "./proxy";

describe("isBearerApiPath", () => {
  it.each(["/api/v1", "/api/v1/", "/api/v1/me", "/api/v1/projects/abc/docs"])(
    "skips the session refresh for %s",
    (path) => {
      expect(isBearerApiPath(path)).toBe(true);
    },
  );

  it.each(["/", "/dashboard", "/api/balance", "/api/v10", "/api/v1beta/x", "/api/auth/wallet/verify"])(
    "keeps the session refresh for %s",
    (path) => {
      expect(isBearerApiPath(path)).toBe(false);
    },
  );
});
