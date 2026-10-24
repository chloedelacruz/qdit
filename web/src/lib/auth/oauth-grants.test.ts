import { describe, expect, it } from "vitest";

import { parseClientId, toAuthorizedApps } from "./oauth-grants";

const CLIENT = "9B8A7C6D-5E4F-4A3B-9C1D-0E9F8A7B6C5D";

describe("parseClientId", () => {
  it("accepts a UUID and lowercases it", () => {
    expect(parseClientId(CLIENT)).toBe(CLIENT.toLowerCase());
  });

  it("refuses anything else", () => {
    for (const value of ["", "doqtri", `${CLIENT}&client_id=x`, undefined, null, 1]) {
      expect(parseClientId(value)).toBeNull();
    }
  });
});

describe("toAuthorizedApps", () => {
  it("maps grants, labels scopes and sorts newest first", () => {
    const apps = toAuthorizedApps([
      {
        client: { id: "a", name: "Old", uri: "https://old.example", logo_uri: "" },
        scopes: ["openid"],
        granted_at: "2026-10-01T00:00:00Z",
      },
      {
        client: { id: "b", name: " doqtri ", uri: "https://www.doqtri.xyz", logo_uri: "" },
        scopes: ["openid", "email"],
        granted_at: "2026-10-24T09:00:00Z",
      },
    ]);

    expect(apps).toEqual([
      {
        clientId: "b",
        name: "doqtri",
        host: "www.doqtri.xyz",
        scopes: [
          { scope: "openid", label: "Confirm who you are on qdit" },
          { scope: "email", label: "See your email address" },
        ],
        grantedAt: "2026-10-24T09:00:00Z",
      },
      {
        clientId: "a",
        name: "Old",
        host: "old.example",
        scopes: [{ scope: "openid", label: "Confirm who you are on qdit" }],
        grantedAt: "2026-10-01T00:00:00Z",
      },
    ]);
  });

  it("copes with missing names, bad URIs and no grants", () => {
    expect(
      toAuthorizedApps([
        {
          client: { id: "c", name: "", uri: "not a url", logo_uri: "" },
          scopes: [],
          granted_at: "2026-10-24T09:00:00Z",
        },
      ]),
    ).toEqual([
      { clientId: "c", name: "Unnamed app", host: null, scopes: [], grantedAt: "2026-10-24T09:00:00Z" },
    ]);
    expect(toAuthorizedApps(null)).toEqual([]);
  });
});
