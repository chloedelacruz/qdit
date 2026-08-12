import { describe, expect, it } from "vitest";

import {
  PLACEHOLDER_EMAIL_DOMAIN,
  hasRecoveryCredential,
  isPlaceholderEmail,
  placeholderEmail,
  walletDisplayName,
} from "@/lib/auth/wallet-identity";

const ADDRESS = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";

describe("placeholderEmail", () => {
  it("is deterministic for one address", () => {
    expect(placeholderEmail(ADDRESS)).toBe(placeholderEmail(ADDRESS));
  });

  it("lowercases, so the same wallet cannot produce two accounts", () => {
    expect(placeholderEmail(ADDRESS)).toBe(
      `${ADDRESS.toLowerCase()}@${PLACEHOLDER_EMAIL_DOMAIN}`,
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(placeholderEmail(`  ${ADDRESS}\n`)).toBe(placeholderEmail(ADDRESS));
  });
});

describe("isPlaceholderEmail", () => {
  it("recognises one it generated", () => {
    expect(isPlaceholderEmail(placeholderEmail(ADDRESS))).toBe(true);
  });

  it("does not fire on a real address", () => {
    expect(isPlaceholderEmail("ada@example.com")).toBe(false);
  });

  it("is case-insensitive, because Supabase does not promise a casing", () => {
    expect(isPlaceholderEmail(`ADA@${PLACEHOLDER_EMAIL_DOMAIN.toUpperCase()}`)).toBe(true);
  });

  it("is not fooled by the domain appearing elsewhere in the address", () => {
    expect(isPlaceholderEmail(`${PLACEHOLDER_EMAIL_DOMAIN}@example.com`)).toBe(false);
  });

  it("treats a missing address as not-a-placeholder", () => {
    // Distinct from hasRecoveryCredential: null is not a placeholder, but it is
    // not a recovery credential either.
    expect(isPlaceholderEmail(null)).toBe(false);
    expect(isPlaceholderEmail(undefined)).toBe(false);
  });
});

describe("hasRecoveryCredential", () => {
  it("is false for a wallet account that has not attached an email", () => {
    expect(hasRecoveryCredential(placeholderEmail(ADDRESS))).toBe(false);
  });

  it("is false when there is no address at all", () => {
    expect(hasRecoveryCredential(null)).toBe(false);
    expect(hasRecoveryCredential("")).toBe(false);
  });

  it("is true once a real address is attached", () => {
    expect(hasRecoveryCredential("ada@example.com")).toBe(true);
  });
});

describe("walletDisplayName", () => {
  it("keeps both ends, which is how addresses are compared by eye", () => {
    expect(walletDisplayName(ADDRESS)).toBe("GCEZ…74JZ");
  });

  it("is short enough to sit inline in prose", () => {
    expect(walletDisplayName(ADDRESS)).toHaveLength(9);
  });
});
