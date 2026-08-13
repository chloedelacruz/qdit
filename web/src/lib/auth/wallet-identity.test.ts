import { describe, expect, it } from "vitest";

import {
  PLACEHOLDER_EMAIL_DOMAIN,
  hasRecoveryCredential,
  isPlaceholderEmail,
} from "@/lib/auth/wallet-identity";

/**
 * These two functions decide whether an account is sent to `/register` or to
 * the dashboard, so the interesting cases are the ones where an address only
 * looks like a placeholder.
 *
 * `placeholderEmail()` and `walletDisplayName()` used to be tested here and no
 * longer exist — registration means nothing mints a placeholder address or
 * names somebody after their own wallet. See the header of the module.
 */

const ADDRESS = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";

/** What the retired auto-create flow wrote into `auth.users`. */
const PLACEHOLDER = `${ADDRESS.toLowerCase()}@${PLACEHOLDER_EMAIL_DOMAIN}`;

describe("isPlaceholderEmail", () => {
  it("recognises one the retired flow would have written", () => {
    expect(isPlaceholderEmail(PLACEHOLDER)).toBe(true);
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

  it("is not fooled by a lookalike domain a registrant could actually own", () => {
    expect(isPlaceholderEmail("ada@notwallet.qdit.local")).toBe(false);
    expect(isPlaceholderEmail("ada@wallet.qdit.local.example.com")).toBe(false);
  });

  it("treats a missing address as not-a-placeholder", () => {
    // Distinct from hasRecoveryCredential: null is not a placeholder, but it is
    // not a recovery credential either.
    expect(isPlaceholderEmail(null)).toBe(false);
    expect(isPlaceholderEmail(undefined)).toBe(false);
  });
});

describe("hasRecoveryCredential", () => {
  it("is false for an account the retired flow created", () => {
    expect(hasRecoveryCredential(PLACEHOLDER)).toBe(false);
  });

  it("is false when there is no address at all", () => {
    expect(hasRecoveryCredential(null)).toBe(false);
    expect(hasRecoveryCredential("")).toBe(false);
  });

  it("is true once a real address is attached", () => {
    expect(hasRecoveryCredential("ada@example.com")).toBe(true);
  });
});
