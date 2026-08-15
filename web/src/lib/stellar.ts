/**
 * Stellar-specific helpers: validation for the proof fields the product is
 * built around, plus explorer link generation (spec §Contract Link Helper).
 *
 * Deliberately dependency-free — none of this needs an SDK or a network call.
 * Real on-chain verification (spec §Transaction Verification) belongs in a
 * server route that talks to Horizon, not here.
 */

export type StellarNetwork = "testnet" | "mainnet";

export const NETWORK_LABELS: Record<StellarNetwork, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
};

/** stellar.expert uses "public" where the product says "mainnet". */
const EXPLORER_NETWORK: Record<StellarNetwork, string> = {
  testnet: "testnet",
  mainnet: "public",
};

const EXPLORER_BASE = "https://stellar.expert/explorer";

/** Horizon endpoints, for server-side transaction lookups. */
export const HORIZON_URL: Record<StellarNetwork, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

/** Soroban RPC endpoints, for contract-level reads. */
export const SOROBAN_RPC_URL: Record<StellarNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

/**
 * Network passphrases, verbatim from SEP-0001.
 *
 * The passphrase is how a wallet says which network it is on — it is mixed into
 * every signature, so a Mainnet wallet signing a Testnet transaction produces
 * bytes the network rejects. Kept here rather than read from the wallet kit's
 * enum so that plain comparisons stay dependency-free and testable.
 */
export const NETWORK_PASSPHRASE: Record<StellarNetwork, string> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

/**
 * Which of the two networks a passphrase belongs to, or null for the ones qdit
 * does not run on — Futurenet, a sandbox, someone's standalone quickstart.
 * "Not ours" and "unknown" are the same problem from the user's side, and the
 * message that follows says so by name.
 */
export function networkFromPassphrase(passphrase: string): StellarNetwork | null {
  if (passphrase === NETWORK_PASSPHRASE.testnet) return "testnet";
  if (passphrase === NETWORK_PASSPHRASE.mainnet) return "mainnet";
  return null;
}

/**
 * Strkeys are base32 (RFC 4648 alphabet, no padding) and fixed-length:
 * contracts are 56 chars starting with C, accounts 56 starting with G.
 */
const BASE32 = "[A-Z2-7]";
const CONTRACT_ID_RE = new RegExp(`^C${BASE32}{55}$`);
const ACCOUNT_ID_RE = new RegExp(`^G${BASE32}{55}$`);
const TX_HASH_RE = /^[0-9a-f]{64}$/i;

export function isContractId(value: string): boolean {
  return CONTRACT_ID_RE.test(value.trim());
}

export function isWalletAddress(value: string): boolean {
  return ACCOUNT_ID_RE.test(value.trim());
}

export function isTxHash(value: string): boolean {
  return TX_HASH_RE.test(value.trim());
}

export function contractUrl(contractId: string, network: StellarNetwork): string {
  return `${EXPLORER_BASE}/${EXPLORER_NETWORK[network]}/contract/${contractId}`;
}

export function txUrl(txHash: string, network: StellarNetwork): string {
  return `${EXPLORER_BASE}/${EXPLORER_NETWORK[network]}/tx/${txHash}`;
}

export function accountUrl(address: string, network: StellarNetwork): string {
  return `${EXPLORER_BASE}/${EXPLORER_NETWORK[network]}/account/${address}`;
}

/* -------------------------------------------------------------------------- */
/* Amounts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * XLM is divisible to exactly seven decimal places, and the protocol counts in
 * the indivisible unit — the stroop. Everything that *arithmetic* happens to
 * goes through `bigint` stroops rather than `number`: 0.1 + 0.2 is a rounding
 * error in float, and a rounding error in a balance is a wrong balance.
 *
 * Horizon speaks decimal strings ("10000.0000000") and so does the SDK's
 * payment builder, so strings are the boundary format in both directions.
 */
export const STROOPS_PER_XLM = 10_000_000n;

/** Every account holds back (2 + subentries) × 0.5 XLM that it cannot spend. */
export const BASE_RESERVE_STROOPS = 5_000_000n;

/**
 * Held back from "spendable" on top of the reserve, so that an account which
 * just sent its whole spendable balance can still pay the fee on the next
 * transaction. 0.001 XLM — a hundred base-fee operations.
 */
export const FEE_BUFFER_STROOPS = 10_000n;

/** Up to 15 digits, then at most 7 decimal places. No sign, no exponent. */
const AMOUNT_RE = /^\d{1,15}(\.\d{1,7})?$/;

/** True for a string the network would accept as a payment amount. */
export function isValidAmount(value: string): boolean {
  const trimmed = value.trim();
  if (!AMOUNT_RE.test(trimmed)) return false;
  // "0" and "0.0000000" parse fine and are not payments.
  return toStroops(trimmed) > 0n;
}

/**
 * Decimal XLM → stroops. Returns 0n for anything unparseable, so display paths
 * cannot throw; validate with `isValidAmount` before using the result to build
 * a transaction.
 */
export function toStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (!AMOUNT_RE.test(trimmed)) return 0n;

  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, "0"));
}

/** Stroops → the decimal string Horizon and the SDK expect. */
export function fromStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;

  const whole = absolute / STROOPS_PER_XLM;
  const fraction = (absolute % STROOPS_PER_XLM).toString().padStart(7, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Formats an amount for display: thousands separated, trailing zeros dropped
 * but never below two decimal places.
 *
 * Two is the floor because a balance rendered as "10,000" reads like a rounded
 * figure, and "10,000.00" reads like a balance. Anything more precise keeps
 * every digit it has — 9,999.9999999 is not 10,000, and rounding it there would
 * tell someone they can send more than they can.
 */
export function formatXlm(amount: string): string {
  const trimmed = amount.trim();
  const [whole = "0", fraction = ""] = trimmed.split(".");

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const kept = fraction.replace(/0+$/, "").padEnd(2, "0");

  return `${grouped}.${kept}`;
}

/**
 * The part of a balance the protocol will not let an account spend.
 *
 * Two base reserves for the account itself, one more for every subentry
 * (trustlines, offers, signers, data entries). Sponsored entries are paid for
 * by somebody else, which is why they subtract: `num_sponsoring` counts the
 * reserves this account is holding on another's behalf, `num_sponsored` the
 * ones another account is holding on its behalf.
 */
export function minimumBalanceStroops(
  subentryCount: number,
  sponsoring = 0,
  sponsored = 0,
): bigint {
  const entries = BigInt(2 + subentryCount + sponsoring - sponsored);
  const minimum = entries * BASE_RESERVE_STROOPS;
  return minimum > 0n ? minimum : 2n * BASE_RESERVE_STROOPS;
}

/**
 * Middle-truncates an identifier for display. Hashes and strkeys are compared
 * by their ends, so both ends are always kept.
 */
export function truncateHash(value: string, lead = 6, tail = 6): string {
  const trimmed = value.trim();
  if (trimmed.length <= lead + tail + 1) return trimmed;
  return `${trimmed.slice(0, lead)}…${trimmed.slice(-tail)}`;
}
