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

/**
 * Middle-truncates an identifier for display. Hashes and strkeys are compared
 * by their ends, so both ends are always kept.
 */
export function truncateHash(value: string, lead = 6, tail = 6): string {
  const trimmed = value.trim();
  if (trimmed.length <= lead + tail + 1) return trimmed;
  return `${trimmed.slice(0, lead)}…${trimmed.slice(-tail)}`;
}
