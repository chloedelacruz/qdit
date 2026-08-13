import { describe, expect, it } from "vitest";

import {
  classifyMemberIdentifier,
  usernameSchema,
  walletRegistrationSchema,
} from "@/lib/schemas";

/**
 * The username schema is load-bearing in a way most of these are not: it is the
 * only thing that lowercases, and `profiles_username_format` rejects anything
 * that is not already lowercase. If this stops transforming, registration stops
 * working for anyone who capitalises a letter — and fails in Postgres with a
 * constraint name rather than in the form with a sentence.
 */

const VALID = { username: "ada", email: "ada@example.com", password: "hunter2" };

describe("usernameSchema", () => {
  it("lowercases rather than rejecting, because the column only holds lowercase", () => {
    expect(usernameSchema.parse("Ada_Lovelace")).toBe("ada_lovelace");
  });

  it("trims, so a trailing space from a paste is not a different name", () => {
    expect(usernameSchema.parse("  ada  ")).toBe("ada");
  });

  it("accepts the character set the CHECK constraint accepts", () => {
    expect(usernameSchema.parse("ada_99")).toBe("ada_99");
  });

  it("refuses characters the database would refuse", () => {
    for (const bad of ["ada lovelace", "ada-lovelace", "ada.lovelace", "adá", "ada!"]) {
      expect(usernameSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("enforces the same 3–30 bound as the CHECK constraint", () => {
    expect(usernameSchema.safeParse("ad").success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(31)).success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(30)).success).toBe(true);
  });
});

describe("walletRegistrationSchema", () => {
  it("takes exactly the three things the form collects", () => {
    expect(walletRegistrationSchema.parse(VALID)).toEqual(VALID);
  });

  it("has no wallet address, so a posted one cannot reach the account", () => {
    // The address comes from the signed ticket. A body field claiming one is
    // stripped here rather than argued with downstream.
    const parsed = walletRegistrationSchema.parse({
      ...VALID,
      walletAddress: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ",
    });

    expect(parsed).not.toHaveProperty("walletAddress");
  });

  it("keeps the password floor Supabase itself enforces", () => {
    expect(walletRegistrationSchema.safeParse({ ...VALID, password: "12345" }).success)
      .toBe(false);
  });
});

/**
 * The classifier decides which of three SECURITY DEFINER functions runs, so a
 * wrong answer is not a cosmetic error — it is "no qdit account uses that
 * username" for a wallet address somebody pasted correctly.
 *
 * The three formats cannot collide, and these pin the reasons why: a username
 * cannot hold an `@`, and cannot look like a `G…` address because uppercase is
 * forbidden by `profiles_username_format`.
 */
describe("classifyMemberIdentifier", () => {
  const ADDRESS = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";

  it("recognises a wallet address", () => {
    expect(classifyMemberIdentifier(ADDRESS)).toEqual({
      kind: "wallet",
      value: ADDRESS,
    });
  });

  it("recognises an email address", () => {
    expect(classifyMemberIdentifier("ada@example.com")).toEqual({
      kind: "email",
      value: "ada@example.com",
    });
  });

  it("recognises a username, and lowercases it the way the column stores it", () => {
    expect(classifyMemberIdentifier("Ada_Lovelace")).toEqual({
      kind: "username",
      value: "ada_lovelace",
    });
  });

  it("ignores surrounding whitespace on all three", () => {
    expect(classifyMemberIdentifier(`  ${ADDRESS}  `).kind).toBe("wallet");
    expect(classifyMemberIdentifier("  ada@example.com ").kind).toBe("email");
    expect(classifyMemberIdentifier("  ada  ").kind).toBe("username");
  });

  it("reads a near-miss address as a broken address, not an overlong username", () => {
    // 56 characters beginning with G, with an invalid base32 character in it.
    const typo = `G1${ADDRESS.slice(2)}`;
    const result = classifyMemberIdentifier(typo);

    expect(result.kind).toBe("invalid");
    expect(result.kind === "invalid" && result.message).toMatch(/56 characters/);
  });

  it("refuses an empty identifier", () => {
    expect(classifyMemberIdentifier("   ").kind).toBe("invalid");
  });

  it("refuses something that is none of the three", () => {
    expect(classifyMemberIdentifier("ad").kind).toBe("invalid");
    expect(classifyMemberIdentifier("has spaces").kind).toBe("invalid");
    expect(classifyMemberIdentifier("not-an-email@").kind).toBe("invalid");
  });
});
