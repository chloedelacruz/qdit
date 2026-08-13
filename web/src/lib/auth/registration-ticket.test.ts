import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";

import {
  TICKET_TTL_SECONDS,
  issueTicket,
  readTicket,
} from "@/lib/auth/registration-ticket";

/**
 * A ticket is the only thing standing between "signed a challenge" and "has an
 * account", so the interesting cases are all the ways it can be made to say
 * something it was not signed to say.
 *
 * Keys are generated rather than fixed, for the reason `challenge.test.ts`
 * states: a hard-coded secret in a test file is a secret in git.
 */

const ADDRESS = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const OTHER_ADDRESS = "GB6YPGW5JFMMP2QB2USQ33EUWTXVL4ZT5ITUNCY3YKVWOJPP57CANOF3";
const SECRET = Keypair.random().secret();

beforeEach(() => {
  process.env.STELLAR_AUTH_SERVER_SECRET = SECRET;
});

describe("issueTicket / readTicket", () => {
  it("round-trips the address it was issued for", () => {
    expect(readTicket(issueTicket(ADDRESS))).toBe(ADDRESS);
  });

  it("says nothing when there is no ticket", () => {
    expect(readTicket(undefined)).toBeNull();
    expect(readTicket(null)).toBeNull();
    expect(readTicket("")).toBeNull();
  });

  it("refuses a ticket that is not three parts", () => {
    expect(readTicket("nonsense")).toBeNull();
    expect(readTicket("a.b")).toBeNull();
    expect(readTicket("a.b.c.d")).toBeNull();
  });

  it("refuses a swapped address, even with a signature that was once valid", () => {
    const [, expiry, signature] = issueTicket(ADDRESS).split(".");
    const forged = [
      Buffer.from(OTHER_ADDRESS, "utf8").toString("base64url"),
      expiry,
      signature,
    ].join(".");

    expect(readTicket(forged)).toBeNull();
  });

  it("refuses an extended expiry", () => {
    const [address, expiry, signature] = issueTicket(ADDRESS).split(".");
    const extended = [address, String(Number(expiry) + 86_400), signature].join(".");

    expect(readTicket(extended)).toBeNull();
  });

  it("refuses a ticket signed with a different key", () => {
    const ticket = issueTicket(ADDRESS);

    process.env.STELLAR_AUTH_SERVER_SECRET = Keypair.random().secret();

    expect(readTicket(ticket)).toBeNull();
  });

  it("expires", () => {
    const issuedAt = Date.now();
    const ticket = issueTicket(ADDRESS, issuedAt);

    // One second inside the window, and one second past it.
    expect(readTicket(ticket, issuedAt + (TICKET_TTL_SECONDS - 1) * 1000)).toBe(ADDRESS);
    expect(readTicket(ticket, issuedAt + (TICKET_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it("outlives the challenge that produced it", () => {
    // The reason this module exists rather than re-verifying the signed XDR:
    // a challenge is valid for 300 seconds and a form takes longer to fill in.
    expect(TICKET_TTL_SECONDS).toBeGreaterThan(300);
  });

  it("says so plainly when the signing key is missing", () => {
    delete process.env.STELLAR_AUTH_SERVER_SECRET;

    expect(() => issueTicket(ADDRESS)).toThrow(/STELLAR_AUTH_SERVER_SECRET/);
  });
});
