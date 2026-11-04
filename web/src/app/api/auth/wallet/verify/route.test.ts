import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real challenge verifier and the real limiter; the session and profile
 * writes, the cookie store and the signed-in user are stood in for, so each
 * test decides who is signed in and what the account side answers.
 */
const signInWithWallet = vi.fn();
const linkWalletToProfile = vi.fn();
vi.mock("@/lib/auth/wallet-session", () => ({
  signInWithWallet: (...args: unknown[]) => signInWithWallet(...args),
  linkWalletToProfile: (...args: unknown[]) => linkWalletToProfile(...args),
}));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getUser: () => getUser() }));

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));

const issueTicket = vi.fn((address: string) => `ticket-for-${address}`);
vi.mock("@/lib/auth/registration-ticket", () => ({
  TICKET_COOKIE: "qdit-wallet-ticket",
  TICKET_COOKIE_OPTIONS: { httpOnly: true },
  issueTicket: (address: string) => issueTicket(address),
}));

const { buildChallenge } = await import("@/lib/auth/challenge");
const { POST } = await import("./route");

const SERVER = Keypair.random();
const WALLET = Keypair.random();
let ip = 0;

function signed(keypair: Keypair = WALLET, address = keypair.publicKey()): string {
  const tx = TransactionBuilder.fromXDR(buildChallenge(address), Networks.TESTNET);
  tx.sign(keypair);
  return tx.toXDR();
}

function post(body: unknown, options: { raw?: string; ip?: string } = {}): NextRequest {
  return new Request("http://127.0.0.1:3000/api/auth/wallet/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": options.ip ?? `10.1.0.${++ip}` },
    body: options.raw ?? JSON.stringify(body),
  }) as unknown as NextRequest;
}

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.STELLAR_AUTH_SERVER_SECRET = SERVER.secret();
  process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
  process.env.NEXT_PUBLIC_STELLAR_NETWORK = "testnet";
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/auth/wallet/verify — request shape", () => {
  it("refuses a body that is not JSON", async () => {
    expect((await POST(post(null, { raw: "nope" }))).status).toBe(400);
  });

  it("refuses a missing signed challenge", async () => {
    const response = await POST(post({ intent: "sign-in" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Expected a signed challenge." });
  });

  it("has no default intent: a missing or unknown one is refused before any verification", async () => {
    for (const intent of [undefined, "both", ""]) {
      const response = await POST(post({ signedXdr: signed(), intent }));
      expect(response.status).toBe(400);
    }
    expect(signInWithWallet).not.toHaveBeenCalled();
    expect(linkWalletToProfile).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/wallet/verify — the signature", () => {
  it("an unsigned challenge proves nothing: 401", async () => {
    const response = await POST(post({ signedXdr: buildChallenge(WALLET.publicKey()), intent: "sign-in" }));
    expect(response.status).toBe(401);
    expect(signInWithWallet).not.toHaveBeenCalled();
  });

  it("a challenge for one wallet signed by another is 401", async () => {
    const other = Keypair.random();
    const response = await POST(post({ signedXdr: signed(other, WALLET.publicKey()), intent: "sign-in" }));
    expect(response.status).toBe(401);
  });

  it("garbage XDR is 401, not a 500", async () => {
    const response = await POST(post({ signedXdr: "AAAA", intent: "sign-in" }));
    expect(response.status).toBe(401);
  });

  it("a missing server secret is a 500 that names no environment variable", async () => {
    const xdr = signed();
    delete process.env.STELLAR_AUTH_SERVER_SECRET;

    const response = await POST(post({ signedXdr: xdr, intent: "sign-in" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("STELLAR");
  });

  it("rate-limits one client after 10 calls a minute", async () => {
    const client = "192.0.2.10";
    for (let i = 0; i < 10; i += 1) {
      expect((await POST(post({ intent: "x" }, { ip: client }))).status).toBe(400);
    }
    expect((await POST(post({ intent: "x" }, { ip: client }))).status).toBe(429);
  });
});

describe("POST /api/auth/wallet/verify — sign-in", () => {
  it("signs in the account holding the address read from the transaction, not the body", async () => {
    signInWithWallet.mockResolvedValueOnce({ status: "signed-in" });
    const decoy = Keypair.random().publicKey();

    const response = await POST(post({ signedXdr: signed(), intent: "sign-in", address: decoy }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ address: WALLET.publicKey(), status: "signed-in" });
    expect(signInWithWallet).toHaveBeenCalledWith(WALLET.publicKey());
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("no account: issues a registration ticket cookie and creates nothing", async () => {
    signInWithWallet.mockResolvedValueOnce({ status: "registration-required" });

    const response = await POST(post({ signedXdr: signed(), intent: "sign-in" }));

    expect(await response.json()).toEqual({ address: WALLET.publicKey(), status: "registration-required" });
    expect(issueTicket).toHaveBeenCalledWith(WALLET.publicKey());
    expect(cookieSet).toHaveBeenCalledWith("qdit-wallet-ticket", `ticket-for-${WALLET.publicKey()}`, {
      httpOnly: true,
    });
  });

  it("never links, even with a session", async () => {
    getUser.mockResolvedValue({ id: "user-1", email: null });
    signInWithWallet.mockResolvedValueOnce({ status: "signed-in" });

    await POST(post({ signedXdr: signed(), intent: "sign-in" }));
    expect(linkWalletToProfile).not.toHaveBeenCalled();
  });

  it("an infrastructure failure is a 500 with nothing internal in the body", async () => {
    signInWithWallet.mockRejectedValueOnce(new Error("SUPABASE_SECRET_KEY is not set (profile 123)"));

    const response = await POST(post({ signedXdr: signed(), intent: "sign-in" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("SUPABASE");
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("POST /api/auth/wallet/verify — link", () => {
  it("needs a signed-in user, and does not fall back to signing in", async () => {
    const response = await POST(post({ signedXdr: signed(), intent: "link" }));
    expect(response.status).toBe(401);
    expect(signInWithWallet).not.toHaveBeenCalled();
    expect(linkWalletToProfile).not.toHaveBeenCalled();
  });

  it("binds the proved address to the signed-in account", async () => {
    getUser.mockResolvedValue({ id: "user-1", email: null });
    linkWalletToProfile.mockResolvedValueOnce({ status: "linked" });

    const response = await POST(post({ signedXdr: signed(), intent: "link" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ address: WALLET.publicKey(), linked: true });
    expect(linkWalletToProfile).toHaveBeenCalledWith("user-1", WALLET.publicKey());
    expect(signInWithWallet).not.toHaveBeenCalled();
  });

  it("a wallet held by another account is 409", async () => {
    getUser.mockResolvedValue({ id: "user-1", email: null });
    linkWalletToProfile.mockResolvedValueOnce({ status: "taken" });

    const response = await POST(post({ signedXdr: signed(), intent: "link" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("another qdit account");
  });

  it("an account that already has a wallet cannot change it: 409", async () => {
    getUser.mockResolvedValue({ id: "user-1", email: null });
    linkWalletToProfile.mockResolvedValueOnce({ status: "already-set" });

    const response = await POST(post({ signedXdr: signed(), intent: "link" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("cannot be changed");
  });

  it("a failed write is a 500 with the reason logged, not returned", async () => {
    getUser.mockResolvedValue({ id: "user-1", email: null });
    linkWalletToProfile.mockResolvedValueOnce({ status: "failed", message: "duplicate key on profiles" });

    const response = await POST(post({ signedXdr: signed(), intent: "link" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("duplicate key");
    expect(errorLog).toHaveBeenCalledWith("wallet link failed", "duplicate key on profiles");
  });
});
