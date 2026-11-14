import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HORIZON_URL, type StellarNetwork } from "@/lib/stellar";
import type { Database } from "@/lib/types/database";

/**
 * The landing page's live numbers. Every count comes from Supabase; the fee
 * is read back from Horizon for the latest milestone_proof transactions qdit
 * recorded, so it is what the network charged, not an estimate.
 */
export type SiteStats = {
  users: number;
  projects: number;
  tasks: number;
  /** Average fee actually charged on recent anchors; null until one can be read. */
  fee: FeeSample | null;
  updatedAt: string;
};

export type FeeSample = {
  avgXlm: number;
  /** How many transactions the average was taken over. */
  sample: number;
  network: StellarNetwork;
  measuredAt: string;
};

/** Recent anchors whose fees are averaged. */
export const FEE_SAMPLE = 40;
const HORIZON_BATCH = 10;
const STROOPS_PER_XLM = 10_000_000;
/** Fees barely move, so the sample is re-measured a few times a day, not per request. */
const FEE_TTL_MS = 6 * 60 * 60 * 1000;

let feeCache: { at: number; network: StellarNetwork; value: FeeSample } | null = null;

/** Average of Horizon `fee_charged` (stroops) in XLM; null when there is nothing to average. */
export function averageFeeXlm(stroops: number[]): number | null {
  const valid = stroops.filter((n) => Number.isFinite(n) && n > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length / STROOPS_PER_XLM;
}

/**
 * Measures what an anchor really costs: the latest milestone_anchors rows on
 * `network`, each fee read back from Horizon. Every anchor is signed by the
 * builder's own wallet, so this is what a builder pays, not what qdit pays.
 */
export async function measureFee(
  admin: SupabaseClient<Database>,
  network: StellarNetwork,
  fetchImpl: typeof fetch = fetch,
): Promise<FeeSample | null> {
  const { data, error } = await admin
    .from("milestone_anchors")
    .select("tx_hash")
    .eq("network", network)
    .order("created_at", { ascending: false })
    .limit(FEE_SAMPLE);
  if (error) throw new Error(`milestone_anchors: ${error.message}`);
  const hashes = (data ?? []).map((row) => row.tx_hash);

  const fees: number[] = [];
  for (let i = 0; i < hashes.length; i += HORIZON_BATCH) {
    const batch = await Promise.all(
      hashes.slice(i, i + HORIZON_BATCH).map(async (hash) => {
        try {
          const res = await fetchImpl(`${HORIZON_URL[network]}/transactions/${hash}`, {
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) return NaN;
          return Number(((await res.json()) as { fee_charged?: unknown }).fee_charged);
        } catch {
          return NaN;
        }
      }),
    );
    fees.push(...batch);
  }

  const avgXlm = averageFeeXlm(fees);
  if (avgXlm === null) return null;
  return {
    avgXlm,
    sample: fees.filter((n) => Number.isFinite(n) && n > 0).length,
    network,
    measuredAt: new Date().toISOString(),
  };
}

/** The cached fee sample, re-measured once it is older than FEE_TTL_MS. A failed re-measure keeps the last one. */
async function cachedFee(
  admin: SupabaseClient<Database>,
  network: StellarNetwork,
  fetchImpl: typeof fetch,
  now = Date.now(),
): Promise<FeeSample | null> {
  const cached = feeCache?.network === network ? feeCache : null;
  if (cached && now - cached.at < FEE_TTL_MS) return cached.value;
  try {
    const value = await measureFee(admin, network, fetchImpl);
    if (value) feeCache = { at: now, network, value };
  } catch (e) {
    console.error(`[stats] fee not measured: ${(e as Error).message}`);
  }
  return feeCache?.network === network ? feeCache.value : null;
}

/** Test hook: forget the cached fee sample. */
export function resetFeeCache() {
  feeCache = null;
}

/** Row count of a table, without reading a row. */
async function count(admin: SupabaseClient<Database>, table: "projects" | "tasks"): Promise<number> {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

/**
 * Sign-ups, projects and tasks across every workspace, plus the average
 * anchor fee. A failed count throws: a zero shown as if it were real is worse
 * than no numbers. A failed fee only drops the fee.
 */
export async function loadSiteStats(
  admin: SupabaseClient<Database>,
  network: StellarNetwork,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteStats> {
  const [fee, users, projects, tasks] = await Promise.all([
    cachedFee(admin, network, fetchImpl),
    // perPage 1: only the total is needed, not the users themselves.
    admin.auth.admin.listUsers({ page: 1, perPage: 1 }).then(({ data, error }) => {
      if (error) throw new Error(`users: ${error.message}`);
      return "total" in data ? data.total : 0;
    }),
    count(admin, "projects"),
    count(admin, "tasks"),
  ]);

  return { users, projects, tasks, fee, updatedAt: new Date().toISOString() };
}
