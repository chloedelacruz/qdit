import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HORIZON_URL } from "@/lib/stellar";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getUser: () => getUser() }));

const { GET } = await import("./route");

const HASH = "4d2f27982c7714f418b7506f6c51b04edc1a2976f2c74a05573d19173d31e5f5";
const fetchMock = vi.fn();

function get(query: string): Request {
  return new Request(`https://qdit.test/api/verify-tx${query}`);
}

function horizon(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const TX = {
  hash: HASH,
  successful: true,
  ledger: 4126783,
  created_at: "2026-10-30T01:02:03Z",
  source_account: "GABC",
  fee_charged: 100,
  operation_count: 1,
  memo: "qdit",
};

beforeEach(() => {
  getUser.mockResolvedValue({ id: "user-1", email: null });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/verify-tx", () => {
  it("is behind the auth gate: 401 when signed out, with no fetch", async () => {
    getUser.mockResolvedValueOnce(null);
    expect((await GET(get(`?hash=${HASH}`))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses something that is not a 64-hex hash", async () => {
    for (const hash of ["", "abc", `${HASH}0`, HASH.replace("4", "z")]) {
      const response = await GET(get(`?hash=${hash}`));
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown network", async () => {
    expect((await GET(get(`?hash=${HASH}&network=pubnet`))).status).toBe(400);
  });

  it("looks the hash up on the chosen network, uncached, and reports what it was", async () => {
    fetchMock.mockReturnValueOnce(horizon(TX));

    const response = await GET(get(`?hash=${HASH}&network=mainnet`));
    expect(fetchMock.mock.calls[0][0]).toBe(`${HORIZON_URL.mainnet}/transactions/${HASH}`);
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
    expect(await response.json()).toEqual({
      hash: HASH,
      network: "mainnet",
      successful: true,
      ledger: 4126783,
      createdAt: "2026-10-30T01:02:03Z",
      sourceAccount: "GABC",
      feeCharged: "100",
      operationCount: 1,
      memo: "qdit",
    });
  });

  it("defaults to testnet, and a missing memo is null", async () => {
    const noMemo: Partial<typeof TX> = { ...TX };
    delete noMemo.memo;
    fetchMock.mockReturnValueOnce(horizon(noMemo));

    const body = await (await GET(get(`?hash=${HASH}`))).json();
    expect(fetchMock.mock.calls[0][0]).toBe(`${HORIZON_URL.testnet}/transactions/${HASH}`);
    expect(body.memo).toBeNull();
  });

  it("an unknown hash is 404 naming the network", async () => {
    fetchMock.mockReturnValueOnce(horizon({}, 404));
    const response = await GET(get(`?hash=${HASH}`));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("testnet");
  });

  it("an unreachable Horizon or a Horizon error is 502", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await GET(get(`?hash=${HASH}`))).status).toBe(502);

    fetchMock.mockReturnValueOnce(horizon({}, 500));
    const response = await GET(get(`?hash=${HASH}`));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Horizon returned 500." });
  });
});
