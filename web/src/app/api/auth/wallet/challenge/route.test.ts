import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

/**
 * The real challenge builder and the real limiter. Each test sends its own
 * `x-forwarded-for`, so the in-memory windows never leak between tests.
 */
const SERVER = Keypair.random();
const WALLET = Keypair.random();
let ip = 0;

function post(body: unknown, options: { raw?: string; ip?: string } = {}): NextRequest {
  return new Request("http://127.0.0.1:3000/api/auth/wallet/challenge", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": options.ip ?? `10.0.0.${++ip}` },
    body: options.raw ?? JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  process.env.STELLAR_AUTH_SERVER_SECRET = SERVER.secret();
  process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:3000";
  process.env.NEXT_PUBLIC_STELLAR_NETWORK = "testnet";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/wallet/challenge", () => {
  it("answers a valid address with a challenge transaction naming that account", async () => {
    const response = await POST(post({ address: WALLET.publicKey() }));
    expect(response.status).toBe(200);

    const { xdr } = (await response.json()) as { xdr: string };
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    expect("operations" in tx && tx.operations.some((op) => op.source === WALLET.publicKey())).toBe(true);
  });

  it("answers any valid address the same way: no account-existence oracle", async () => {
    const stranger = Keypair.random().publicKey();
    const response = await POST(post({ address: stranger }));
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json())).toEqual(["xdr"]);
  });

  it("refuses a body that is not JSON", async () => {
    const response = await POST(post(null, { raw: "{not json" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Expected a JSON body." });
  });

  it("refuses a missing or non-string address", async () => {
    for (const body of [{}, { address: 42 }, { address: null }]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Expected an address." });
    }
  });

  it("a malformed address is the caller's fault: 400 with the reason", async () => {
    const response = await POST(post({ address: "not-an-address" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual(expect.any(String));
  });

  it("a missing server secret is a 500 that names no environment variable", async () => {
    delete process.env.STELLAR_AUTH_SERVER_SECRET;

    const response = await POST(post({ address: WALLET.publicKey() }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Wallet sign-in is not configured." });
    expect(JSON.stringify(body)).not.toContain("STELLAR_AUTH_SERVER_SECRET");
  });

  it("rate-limits one client after 20 calls a minute", async () => {
    const client = "192.0.2.77";
    for (let i = 0; i < 20; i += 1) {
      expect((await POST(post({ address: WALLET.publicKey() }, { ip: client }))).status).toBe(200);
    }
    const refused = await POST(post({ address: WALLET.publicKey() }, { ip: client }));
    expect(refused.status).toBe(429);

    // Another client is unaffected.
    expect((await POST(post({ address: WALLET.publicKey() }))).status).toBe(200);
  });
});
