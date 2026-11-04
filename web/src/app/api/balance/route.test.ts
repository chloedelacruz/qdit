import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HORIZON_URL } from "@/lib/stellar";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getUser: () => getUser() }));

const { GET } = await import("./route");

const ADDRESS = Keypair.random().publicKey();
const fetchMock = vi.fn();

function get(query: string): Request {
  return new Request(`https://qdit.test/api/balance${query}`);
}

function horizon(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ADDRESS,
    subentry_count: 0,
    balances: [{ asset_type: "native", balance: "10.0000000" }],
    ...overrides,
  };
}

beforeEach(() => {
  getUser.mockResolvedValue({ id: "user-1", email: null });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/balance — the gate and the input", () => {
  it("is not an open Horizon proxy: 401 when signed out, with no fetch", async () => {
    getUser.mockResolvedValueOnce(null);
    const response = await GET(get(`?address=${ADDRESS}`));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses something that is not an account address", async () => {
    const contract = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
    for (const address of ["", "nope", contract]) {
      expect((await GET(get(`?address=${address}`))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an unknown network", async () => {
    const response = await GET(get(`?address=${ADDRESS}&network=futurenet`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown network." });
  });

  it("defaults to testnet and reads the account uncached", async () => {
    fetchMock.mockReturnValueOnce(horizon(account()));
    await GET(get(`?address=${ADDRESS}`));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${HORIZON_URL.testnet}/accounts/${ADDRESS}`);
    expect(init.cache).toBe("no-store");
  });

  it("reads mainnet from the mainnet Horizon", async () => {
    fetchMock.mockReturnValueOnce(horizon(account()));
    const response = await GET(get(`?address=${ADDRESS}&network=mainnet`));
    expect(fetchMock.mock.calls[0][0]).toBe(`${HORIZON_URL.mainnet}/accounts/${ADDRESS}`);
    expect((await response.json()).network).toBe("mainnet");
  });
});

describe("GET /api/balance — the numbers", () => {
  it("reports balance, reserve and spendable (minus the fee buffer)", async () => {
    fetchMock.mockReturnValueOnce(horizon(account()));
    const body = await (await GET(get(`?address=${ADDRESS}`))).json();

    // Two base reserves of 0.5 XLM for an account with no subentries.
    expect(body).toEqual({
      address: ADDRESS,
      network: "testnet",
      funded: true,
      balance: "10.0000000",
      reserve: "1.0000000",
      spendable: "8.9990000",
      subentryCount: 0,
    });
  });

  it("counts subentries, sponsorships and selling liabilities into the reserve", async () => {
    fetchMock.mockReturnValueOnce(
      horizon(
        account({
          subentry_count: 3,
          num_sponsoring: 1,
          num_sponsored: 2,
          balances: [
            { asset_type: "credit_alphanum4", balance: "500.0000000" },
            { asset_type: "native", balance: "10.0000000", selling_liabilities: "1.5000000" },
          ],
        }),
      ),
    );
    const body = await (await GET(get(`?address=${ADDRESS}`))).json();

    // (2 + 3 + 1 − 2) × 0.5 = 2 XLM, plus 1.5 XLM of liabilities.
    expect(body.reserve).toBe("3.5000000");
    expect(body.spendable).toBe("6.4990000");
    expect(body.subentryCount).toBe(3);
  });

  it("floors spendable at zero for an account at its minimum", async () => {
    fetchMock.mockReturnValueOnce(horizon(account({ balances: [{ asset_type: "native", balance: "1.0000000" }] })));
    const body = await (await GET(get(`?address=${ADDRESS}`))).json();
    expect(body.spendable).toBe("0.0000000");
  });

  it("an account Horizon has never seen is unfunded, not an error", async () => {
    fetchMock.mockReturnValueOnce(horizon({ status: 404 }, 404));
    const response = await GET(get(`?address=${ADDRESS}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ funded: false, balance: "0.0000000", spendable: "0.0000000" });
  });
});

describe("GET /api/balance — Horizon failures", () => {
  it("an unreachable Horizon is 502", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const response = await GET(get(`?address=${ADDRESS}`));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("Could not reach Horizon");
  });

  it("a Horizon error status is 502 naming the status", async () => {
    fetchMock.mockReturnValueOnce(horizon({}, 503));
    const response = await GET(get(`?address=${ADDRESS}`));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Horizon returned 503." });
  });
});
