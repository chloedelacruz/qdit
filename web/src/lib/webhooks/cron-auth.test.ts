import { describe, expect, it } from "vitest";

import { isCronAuthorized } from "./cron-auth";

const SECRET = "s3cret-value-from-vault";

describe("isCronAuthorized", () => {
  it("accepts exactly `Bearer <CRON_SECRET>`", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a missing header", () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
  });

  it("refuses every header when CRON_SECRET is unset or empty", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer x", "")).toBe(false);
  });

  it("refuses a wrong secret, including a prefix or extension of the real one", () => {
    expect(isCronAuthorized("Bearer wrong", SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it("refuses another scheme, a lower-case scheme or the bare secret", () => {
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(isCronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer  ${SECRET}`, SECRET)).toBe(false);
  });
});
