/**
 * `@qdit/verify`: check qdit records on Stellar testnet without trusting
 * qdit's app or database. v0.1 reads `milestone_proof_v2` only.
 */

export { verifyMilestone } from "./milestone.ts";
export type { MilestoneStatus, MilestoneVerification, VerifyMilestoneInput } from "./milestone.ts";
export { verifyInclusion } from "./inclusion.ts";
export type { AnchoredBatch, InclusionVerification, SubmissionCheck, VerifyInclusionOptions } from "./inclusion.ts";
export {
  CONTRACT_ERRORS,
  KNOWN_V2_CONTRACT_IDS,
  KNOWN_V2_WASM_HASHES,
  NETWORK,
  TESTNET_RPC_URL,
  VerifyError,
} from "./chain.ts";
export type { ChainOptions, RpcLike, VerifyErrorCode } from "./chain.ts";
export { compareWithContract, decodeEvent, foldEvents, replay, KNOWN_V2_DEPLOY_LEDGERS, SNAPSHOT_FORMAT } from "./replay.ts";
export type {
  ContractComparison,
  EventRpcLike,
  ReplayBatch,
  ReplayEvent,
  ReplayMilestone,
  ReplayOptions,
  ReplayProject,
  ReplaySnapshot,
} from "./replay.ts";
