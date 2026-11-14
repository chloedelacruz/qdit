import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HORIZON_URL } from "@/lib/stellar";
import type { Database } from "@/lib/types/database";

import { FEE_SAMPLE, averageFeeXlm, loadSiteStats, measureFee, resetFeeCache } from "./site-stats";

const hash = (n: number) => n.toString(16).padStart(64, "0");

type Fake = {
  users?: { data: { total?: number }; error: { message: string } | null };
  counts?: Record<string, { count: number | null; error: { message: string } | null }>;
  anchors?: { data: { tx_hash: string }[] | null; error: { message: string } | null };
};

/** Just enough of the Supabase client for loadSiteStats, recording what it asked. */
function fakeAdmin(fake: Fake) {
  const calls = { anchorsNetwork: "" as string, anchorsLimit: 0 };
  const client = {
    auth: {
      admin: {
        listUsers: vi.fn(async () => fake.users ?? { data: { total: 3 }, error: null }),
      },
    },
    from(table: string) {
      if (table === "milestone_anchors") {
        const chain = {
          select: () => chain,
          eq: (_col: string, network: string) => ((calls.anchorsNetwork = network), chain),
          order: () => chain,
          limit: async (n: number) => {
            calls.anchorsLimit = n;
            return fake.anchors ?? { data: [], error: null };
          },
        };
        return chain;
      }
      return {
        select: async (_cols: string, opts: { count: string; head: boolean }) => {
          expect(opts).toEqual({ count: "exact", head: true });
          return fake.counts?.[table] ?? { count: 0, error: null };
        },
      };
    },
  };
  return { admin: client as unknown as SupabaseClient<Database>, calls };
}

function horizon(fees: Record<string, number | "fail">) {
  return vi.fn(async (url: string) => {
    const id = url.split("/").pop()!;
    const fee = fees[id];
    if (fee === undefined || fee === "fail") return new Response("{}", { status: 404 });
    return Response.json({ fee_charged: String(fee) });
  }) as unknown as typeof fetch;
}

beforeEach(() => resetFeeCache());

describe("averageFeeXlm", () => {
  it("averages stroops into XLM", () => {
    expect(averageFeeXlm([100_000, 300_000])).toBeCloseTo(0.02);
  });

  it("skips unreadable fees, and has nothing to say when none are left", () => {
    expect(averageFeeXlm([NaN, 0, 200_000])).toBeCloseTo(0.02);
    expect(averageFeeXlm([NaN, 0])).toBeNull();
    expect(averageFeeXlm([])).toBeNull();
  });
});

describe("measureFee", () => {
  it("reads the latest anchors on the network and averages what Horizon charged", async () => {
    const { admin, calls } = fakeAdmin({
      anchors: { data: [{ tx_hash: hash(1) }, { tx_hash: hash(2) }, { tx_hash: hash(3) }], error: null },
    });
    const fetchImpl = horizon({ [hash(1)]: 100_000, [hash(2)]: 500_000, [hash(3)]: "fail" });

    const fee = await measureFee(admin, "testnet", fetchImpl);

    expect(calls).toEqual({ anchorsNetwork: "testnet", anchorsLimit: FEE_SAMPLE });
    expect(fetchImpl).toHaveBeenCalledWith(`${HORIZON_URL.testnet}/transactions/${hash(1)}`, expect.anything());
    expect(fee).toMatchObject({ sample: 2, network: "testnet" });
    expect(fee!.avgXlm).toBeCloseTo(0.03);
  });

  it("is null when there are no anchors yet", async () => {
    const { admin } = fakeAdmin({});
    expect(await measureFee(admin, "testnet", horizon({}))).toBeNull();
  });
});

describe("loadSiteStats", () => {
  it("returns sign-ups, projects, tasks and the fee", async () => {
    const { admin } = fakeAdmin({
      users: { data: { total: 256 }, error: null },
      counts: { projects: { count: 41, error: null }, tasks: { count: 1214, error: null } },
      anchors: { data: [{ tx_hash: hash(1) }], error: null },
    });

    const stats = await loadSiteStats(admin, "testnet", horizon({ [hash(1)]: 398_900 }));

    expect(stats).toMatchObject({ users: 256, projects: 41, tasks: 1214 });
    expect(stats.fee).toMatchObject({ sample: 1, network: "testnet" });
    expect(stats.fee!.avgXlm).toBeCloseTo(0.03989);
  });

  it("throws on a failed count instead of reporting zero", async () => {
    const { admin } = fakeAdmin({ counts: { tasks: { count: null, error: { message: "denied" } } } });
    await expect(loadSiteStats(admin, "testnet", horizon({}))).rejects.toThrow("tasks: denied");
  });

  it("drops only the fee when anchors cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = fakeAdmin({ anchors: { data: null, error: { message: "boom" } } });
    const stats = await loadSiteStats(admin, "testnet", horizon({}));
    expect(stats.fee).toBeNull();
    expect(stats.users).toBe(3);
    error.mockRestore();
  });

  it("measures the fee once and serves it from cache after", async () => {
    const { admin } = fakeAdmin({ anchors: { data: [{ tx_hash: hash(1) }], error: null } });
    const fetchImpl = horizon({ [hash(1)]: 100_000 });
    await loadSiteStats(admin, "testnet", fetchImpl);
    await loadSiteStats(admin, "testnet", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
