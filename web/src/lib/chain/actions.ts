"use server";

import { revalidatePath } from "next/cache";

import {
  buildUnsigned,
  chainConfig,
  reconcileHash,
  submitSigned,
  type ChainConfig,
  type ChainMethod,
} from "@/lib/chain/client";
import {
  milestoneProofHash,
  proofHashBytes,
  type MilestoneDigestInput,
} from "@/lib/milestone-hash";
import { MILESTONE_OWNER_ONLY, type MilestoneStatus } from "@/lib/constants";
import { isWalletAddress } from "@/lib/stellar";
import { createClient, getUser } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/actions";

/**
 * Anchoring a milestone on chain.
 *
 * Kept out of `actions.ts` because the shape is different from everything
 * there. A normal action is one call that validates and writes. These come in
 * pairs, because the signature has to happen in the browser:
 *
 *     prepare*  → server: authorize, hash, build + simulate, return XDR
 *     (wallet)  → browser: sign the XDR string, nothing else
 *     submit*   → server: verify the signature's transaction, submit, record
 *
 * Anchoring is deliberately **additive**. It never writes `milestones.status`.
 * Moving a milestone through the approval flow (`updateMilestoneStatus` in
 * `actions.ts`) and proving it on chain are separate acts, and the two are
 * allowed to disagree — a milestone can be approved in the app and not yet
 * anchored, or anchored against an older proof hash. The UI shows both rather
 * than pretending one implies the other.
 */

/** What the browser needs in order to raise a signing prompt. */
export type PreparedAnchor = {
  xdr: string;
  contractId: string;
  network: "testnet" | "mainnet";
  /** Null for project registration, which anchors no content. */
  proofHash: string | null;
  /**
   * The simulated fee in stroops, for showing what this costs *before* the
   * wallet prompt. A tester asked for it in those words; another wanted to
   * project what a quarter of mainnet anchoring would come to and had no number
   * to multiply.
   */
  feeStroops: string | null;
};

type Prepared = { ok: true; data: PreparedAnchor } | { ok: false; error: string };

function revalidateAll(): void {
  revalidatePath("/", "layout");
}

function notConfigured(): string {
  return "On-chain anchoring is not configured for this deployment.";
}

/**
 * Loads everything the digest covers.
 *
 * Both the milestone and its linked proofs, because a proof attached to a
 * milestone is part of what the anchor attests to — adding one changes the
 * hash, and the milestone reads as stale until it is re-anchored.
 */
async function digestInput(milestoneId: string): Promise<MilestoneDigestInput | null> {
  const supabase = await createClient();

  const { data: milestone } = await supabase
    .from("milestones")
    .select("id, project_id, title, description, due_date")
    .eq("id", milestoneId)
    .maybeSingle();

  if (!milestone) return null;

  const { data: proofs } = await supabase
    .from("stellar_proofs")
    .select("id, contract_id, tx_hash, network, wallet_address, proof_url")
    .eq("milestone_id", milestoneId);

  return {
    id: milestone.id,
    projectId: milestone.project_id,
    title: milestone.title,
    description: milestone.description,
    dueDate: milestone.due_date,
    proofs: (proofs ?? []).map((proof) => ({
      id: proof.id,
      contractId: proof.contract_id,
      txHash: proof.tx_hash,
      network: proof.network,
      walletAddress: proof.wallet_address,
      proofUrl: proof.proof_url,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Project registration                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Build the `create_project_ref` transaction.
 *
 * A project must exist on chain before any of its milestones can be anchored;
 * `submit_milestone_proof` returns `ProjectNotFound` otherwise. This is a
 * once-per-project act, and only the project owner should do it, because the
 * address that registers is the only one the contract will accept an approval
 * or rejection from afterwards — whatever `project_members` says.
 */
export async function prepareProjectRegistration(
  projectId: string,
  signer: string,
): Promise<Prepared> {
  const config = chainConfig();
  if (!config) return { ok: false, error: notConfigured() };
  if (!isWalletAddress(signer)) {
    return { ok: false, error: "That is not a Stellar account address." };
  }

  const user = await getUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, owner_id, chain_contract_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) return { ok: false, error: "That project no longer exists." };
  if (project.owner_id !== user.id) {
    return {
      ok: false,
      error:
        "Only the project owner can register it on chain — the registering address is the only one that can approve milestones afterwards.",
    };
  }
  if (project.chain_contract_id) {
    return { ok: false, error: "This project is already registered on chain." };
  }

  try {
    const built = await buildUnsigned({
      config,
      signer,
      method: "create_project_ref",
      args: { project_id: projectId, owner: signer },
    });
    return {
      ok: true,
      data: {
        xdr: built.xdr,
        contractId: config.contractId,
        network: config.network,
        proofHash: null,
        feeStroops: built.feeStroops,
      },
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function submitProjectRegistration(
  projectId: string,
  signedXdr: string,
): Promise<ActionState> {
  const config = chainConfig();
  if (!config) return { error: notConfigured() };

  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  try {
    const result = await submitSigned(signedXdr, config, "create_project_ref");

    if (result.status === "pending") {
      // Submitted but not yet confirmed. Registration is all-or-nothing on the
      // project row (the chain_registration_complete constraint), so nothing is
      // written until the ledger confirms — but the hash is handed back so it is
      // not lost, and re-running registration once it lands comes back
      // "already registered" from the contract rather than double-registering.
      return { pending: true, txHash: result.txHash };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .update({
        chain_contract_id: config.contractId,
        chain_network: config.network,
        chain_owner_address: result.signer,
        chain_registered_tx: result.txHash,
        chain_registered_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (error) return { error: error.message };

    revalidateAll();
    return { ok: true };
  } catch (error) {
    return { error: describe(error) };
  }
}

/* -------------------------------------------------------------------------- */
/* Milestone anchoring                                                        */
/* -------------------------------------------------------------------------- */

export type AnchorAction = "submit" | "approve" | "reject";

const METHOD: Record<AnchorAction, ChainMethod> = {
  submit: "submit_milestone_proof",
  approve: "approve_milestone",
  reject: "reject_milestone",
};

/** Which app status an on-chain action corresponds to, for the owner check. */
const IMPLIED_STATUS: Record<AnchorAction, MilestoneStatus> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
};

export async function prepareMilestoneAnchor(
  milestoneId: string,
  action: AnchorAction,
  signer: string,
): Promise<Prepared> {
  const config = chainConfig();
  if (!config) return { ok: false, error: notConfigured() };
  if (!isWalletAddress(signer)) {
    return { ok: false, error: "That is not a Stellar account address." };
  }

  const user = await getUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { data: milestone } = await supabase
    .from("milestones")
    .select("id, project_id, projects(owner_id, chain_contract_id, chain_owner_address)")
    .eq("id", milestoneId)
    .maybeSingle();

  if (!milestone) return { ok: false, error: "That milestone no longer exists." };

  // PostgREST describes a many-to-one embed as an array for some shapes.
  const project = Array.isArray(milestone.projects)
    ? milestone.projects[0]
    : milestone.projects;

  if (!project?.chain_contract_id) {
    return {
      ok: false,
      error: "Register this project on chain first — its milestones cannot be anchored until then.",
    };
  }
  if (project.chain_contract_id !== config.contractId) {
    return {
      ok: false,
      error:
        "This project is registered against a different contract than this deployment uses. Anchoring it here would split its history.",
    };
  }

  // The same rule updateMilestoneStatus enforces, and the same one the contract
  // enforces — checked here so the user is told why before a signing prompt
  // appears rather than after the simulation fails.
  if (MILESTONE_OWNER_ONLY.includes(IMPLIED_STATUS[action]) && project.owner_id !== user.id) {
    return { ok: false, error: "Only the project owner can approve or reject a milestone." };
  }
  if (action !== "submit" && project.chain_owner_address !== signer) {
    return {
      ok: false,
      error: `Approve and reject must be signed by the address that registered this project (${project.chain_owner_address}).`,
    };
  }

  const input = await digestInput(milestoneId);
  if (!input) return { ok: false, error: "That milestone no longer exists." };

  const proofHash = milestoneProofHash(input);
  const args =
    action === "submit"
      ? {
          project_id: milestone.project_id,
          milestone_id: milestoneId,
          submitter: signer,
          proof_hash: proofHashBytes(proofHash),
        }
      : {
          project_id: milestone.project_id,
          milestone_id: milestoneId,
          approver: signer,
        };

  try {
    const built = await buildUnsigned({ config, signer, method: METHOD[action], args });
    return {
      ok: true,
      data: {
        xdr: built.xdr,
        contractId: config.contractId,
        network: config.network,
        // Only a submission anchors content. Approve and reject attest to a
        // hash already on chain, which is why the column is null for them.
        proofHash: action === "submit" ? proofHash : null,
        feeStroops: built.feeStroops,
      },
    };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function submitMilestoneAnchor(
  milestoneId: string,
  action: AnchorAction,
  signedXdr: string,
  proofHash: string | null,
): Promise<ActionState> {
  const config = chainConfig();
  if (!config) return { error: notConfigured() };

  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { data: milestone } = await supabase
    .from("milestones")
    .select("id, project_id")
    .eq("id", milestoneId)
    .maybeSingle();

  if (!milestone) return { error: "That milestone no longer exists." };

  try {
    const result = await submitSigned(signedXdr, config, METHOD[action]);

    if (result.status === "pending") {
      // Submitted, but the ledger had not confirmed it within the budget. No
      // anchor row is written — the version cannot be read back until it lands,
      // and a row here would assert a confirmation we do not have — but the hash
      // goes back to the caller so it can be watched and reconciled rather than
      // lost. This is the round-1 "nothing to show for it" (FEEDBACK-PLAN §P0).
      return { pending: true, txHash: result.txHash };
    }

    return await recordAnchor(config, {
      milestoneId,
      projectId: milestone.project_id,
      action,
      proofHash,
      txHash: result.txHash,
      signer: result.signer,
      ledger: result.ledger,
      userId: user.id,
    });
  } catch (error) {
    return { error: describe(error) };
  }
}

/**
 * Reconcile a submission that came back `pending`.
 *
 * The transaction was sent and the caller kept the hash; this asks the ledger
 * whether it has since landed, and if it has, records the anchor exactly as the
 * live path would have. Nothing is resubmitted — a pending transaction is
 * already on the network, and sending it again would only race itself.
 *
 * Idempotent by the `tx_hash` unique constraint: reconciling twice, or
 * reconciling one the live poll also caught, records the row once and reports
 * success both times.
 */
export async function reconcileMilestoneAnchor(
  milestoneId: string,
  action: AnchorAction,
  txHash: string,
  proofHash: string | null,
): Promise<ActionState> {
  const config = chainConfig();
  if (!config) return { error: notConfigured() };

  const user = await getUser();
  if (!user) return { error: "Your session expired. Sign in again." };

  const supabase = await createClient();
  const { data: milestone } = await supabase
    .from("milestones")
    .select("id, project_id")
    .eq("id", milestoneId)
    .maybeSingle();

  if (!milestone) return { error: "That milestone no longer exists." };

  try {
    const outcome = await reconcileHash(txHash, config);
    if (outcome.status === "pending") {
      // Still not on the ledger. Not an error — keep the hash, keep waiting.
      return { pending: true, txHash };
    }
    if (outcome.status === "failed") {
      return { error: "That transaction failed on chain. Nothing was recorded." };
    }

    return await recordAnchor(config, {
      milestoneId,
      projectId: milestone.project_id,
      action,
      proofHash,
      txHash,
      signer: outcome.signer,
      ledger: outcome.ledger,
      userId: user.id,
    });
  } catch (error) {
    return { error: describe(error) };
  }
}

/**
 * Read the version back from the contract, then write the anchor row.
 *
 * Shared by the live submit path and the after-the-fact reconcile so a
 * reconciled anchor is byte-for-byte what an inline one would have been. The
 * version is read from the contract, not guessed: the record is the authority
 * on what was written, and a concurrent submission would make a local counter
 * wrong.
 */
async function recordAnchor(
  config: ChainConfig,
  params: {
    milestoneId: string;
    projectId: string;
    action: AnchorAction;
    proofHash: string | null;
    txHash: string;
    signer: string;
    ledger: number | null;
    userId: string;
  },
): Promise<ActionState> {
  const version = await readVersion(config, params.projectId, params.milestoneId);

  const supabase = await createClient();
  const { error } = await supabase.from("milestone_anchors").insert({
    milestone_id: params.milestoneId,
    project_id: params.projectId,
    action: params.action,
    // Only a submission carries a hash; approve and reject attest to one already
    // on chain.
    proof_hash: params.action === "submit" ? params.proofHash : null,
    version,
    contract_id: config.contractId,
    network: config.network,
    tx_hash: params.txHash,
    // From the verified transaction, never from profiles.wallet_address: the
    // signature is the proof, the profile is a convenience field.
    signer_address: params.signer,
    ledger: params.ledger,
    created_by: params.userId,
  });

  if (error) {
    // The tx_hash unique constraint firing means this anchor is already
    // recorded — a reconcile catching what the live poll also caught. The row
    // exists, which is all anyone wanted.
    if (error.code === "23505") return { ok: true };
    return { error: error.message };
  }

  revalidateAll();
  return { ok: true };
}

/** `get_milestone_status().version`, read through simulation — free, no signature. */
async function readVersion(
  config: ReturnType<typeof chainConfig> & object,
  projectId: string,
  milestoneId: string,
): Promise<number> {
  const { Client } = await import("@/lib/chain/bindings");
  const { SOROBAN_RPC_URL } = await import("@/lib/stellar");
  const { NETWORK_PASSPHRASE } = await import("@/lib/chain/client");

  const client = new Client({
    contractId: config.contractId,
    networkPassphrase: NETWORK_PASSPHRASE[config.network],
    rpcUrl: SOROBAN_RPC_URL[config.network],
    allowHttp: false,
  });

  const assembled = await client.get_milestone_status({
    project_id: projectId,
    milestone_id: milestoneId,
  });
  const result = assembled.result;

  if (result.isOk()) return result.unwrap().version;
  throw new Error("The transaction succeeded but the record could not be read back.");
}

/** Contract errors arrive as thrown objects; surface the useful part. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("ProjectExists")) return "This project is already registered on chain.";
  if (message.includes("ProjectNotFound")) {
    return "This project is not registered on chain yet.";
  }
  if (message.includes("MilestoneNotFound")) {
    return "This milestone has no proof on chain yet — submit one before approving it.";
  }
  if (message.includes("NotAuthorized")) {
    return "That address is not the one this project was registered with.";
  }
  if (message.includes("InvalidStatus")) {
    return "The chain will not accept that transition — an approved milestone is final.";
  }
  if (message.includes("IdTooLong")) return "That identifier is too long for the contract.";

  return message;
}
