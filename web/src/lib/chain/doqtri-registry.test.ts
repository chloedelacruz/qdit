import { Address, SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_TTL_MS,
  FAILURE_TTL_MS,
  FRESH_REUSE_MS,
  checkDocSource,
  checkMilestoneRecord,
  clearRegistryCache,
  compareDocSource,
  decodeDocument,
  decodeMilestone,
  decodeNode,
  docVerdict,
  milestoneToRead,
  namesThisMilestone,
  nodeAttestation,
  parseQditArtifactRef,
  plannedVerdict,
  readMilestone,
  readRegistry,
  registryConfig,
  verifiedOnChain,
  type DocSourceCheck,
  type DocSourceContext,
  type MilestoneRead,
  type NodeAttestation,
  type RegistryNode,
  type RegistryRead,
} from "@/lib/chain/doqtri-registry";
import { readPublicChain } from "@/lib/public-proof-chain";
import type { PublicProof } from "@/lib/queries";

/**
 * The DoqtriRegistry reader behind the public page's "Planned in doqtri"
 * block (WP-3.2), against a mocked Soroban RPC.
 *
 * The XDR below is real. It was produced by DoqtriRegistry v3's own wasm (the
 * build of doqtri's contract/ on integration/suite that G1 and G2 ran) in a
 * soroban-sdk 22 test host: three `anchor` calls on doc
 * c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f, the last signing `h4` Verified with
 * tool "qdit" and the contract's artifact_ref, and `h2` Built as a rollup;
 * then get_document and get_node, with each return value encoded as ScVal
 * XDR. The same host showed the two "no such record" reads failing with
 * Error(Contract, #2) (get_document) and Error(Contract, #3) (get_node).
 *
 * The MilestoneRecord XDR is real too: qdit's milestone_proof (this branch's
 * contracts/milestone_proof, as an rlib) in a soroban-sdk 27 test host, one
 * fresh contract per life of milestone b81e4f07-… of project 3f6c2a1e-…
 * (submit; submit, reject, submit; … approve; … reject; … submit), each
 * get_milestone_status return value encoded as ScVal XDR. Its "no record"
 * is Error(Contract, #3), MilestoneNotFound (the G2 milestone host).
 */

const DOC_ID = "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f";
const PROJECT = "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34";
const MILESTONE = "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61";
const OTHER_UUID = "00000000-0000-4000-8000-000000000000";
const PROOF_CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const REGISTRY = "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ";
/** The submitter the milestone_proof test host signed every RECORD with. */
const SUBMITTER = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M";

const XDR = {
  /** Document { version: 3, node_count: 2, content_hash: [3; 32], updated_at: 1792843200, owner: GAAZ…CWN7 } */
  document:
    "AAAAEQAAAAEAAAAFAAAADwAAAAxjb250ZW50X2hhc2gAAAANAAAAIAMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAAAADwAAAApub2RlX2NvdW50AAAAAAADAAAAAgAAAA8AAAAFb3duZXIAAAAAAAASAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAAAA8AAAAKdXBkYXRlZF9hdAAAAAAABQAAAABq3J3AAAAADwAAAAd2ZXJzaW9uAAAAAAMAAAAD",
  /** NodeRecord { status: Verified, tool: "qdit", artifact_ref: qdit:testnet:CBP3…:3f6c…/b81e…@v2 } */
  nodeQdit:
    "AAAAEQAAAAEAAAAEAAAADwAAAAxhcnRpZmFjdF9yZWYAAAAOAAAAknFkaXQ6dGVzdG5ldDpDQlAzTktYQ1JVU09KTExVWERGNUFJUk5QQUM2SUw3VEZKMktDTkw1QTJHVEtDMk1CN000T0hWRzozZjZjMmExZS04YjRkLTRjN2UtOWExMC0yZDViN2U5ZjFjMzQvYjgxZTRmMDctNmEyYy00ZDkzLThlNWYtMGM3YTliM2QyZTYxQHYyAAAAAAAPAAAABnN0YXR1cwAAAAAAEAAAAAEAAAABAAAADwAAAAhWZXJpZmllZAAAAA8AAAAEdG9vbAAAAA4AAAAEcWRpdAAAAA8AAAAKdXBkYXRlZF9hdAAAAAAABQAAAABq3J3A",
  /** NodeRecord { status: Built, tool: "rollup", artifact_ref: "children:h3,h4" } */
  nodeRollup:
    "AAAAEQAAAAEAAAAEAAAADwAAAAxhcnRpZmFjdF9yZWYAAAAOAAAADmNoaWxkcmVuOmgzLGg0AAAAAAAPAAAABnN0YXR1cwAAAAAAEAAAAAEAAAABAAAADwAAAAVCdWlsdAAAAAAAAA8AAAAEdG9vbAAAAA4AAAAGcm9sbHVwAAAAAAAPAAAACnVwZGF0ZWRfYXQAAAAAAAUAAAAAatydwA==",
  /** The ScString arguments the contract host built for doc id and `h4`. */
  docIdArg: "AAAADgAAACRjMmQxZTBmOS04YTdiLTRjNmQtOWU1Zi00YTNiMmMxZDBlOWY=",
  nodeIdArg: "AAAADgAAAAJoNAAA",
};

/** milestone_proof `MilestoneRecord`s for MILESTONE of PROJECT, by status and version. */
const RECORD = {
  submitted_v1: "AAAAEQAAAAEAAAAHAAAADwAAAAxtaWxlc3RvbmVfaWQAAAAOAAAAJGI4MWU0ZjA3LTZhMmMtNGQ5My04ZTVmLTBjN2E5YjNkMmU2MQAAAA8AAAAKcHJvamVjdF9pZAAAAAAADgAAACQzZjZjMmExZS04YjRkLTRjN2UtOWExMC0yZDViN2U5ZjFjMzQAAAAPAAAACnByb29mX2hhc2gAAAAAAA0AAAAgAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEAAAAPAAAABnN0YXR1cwAAAAAAEAAAAAEAAAABAAAADwAAAAlTdWJtaXR0ZWQAAAAAAAAPAAAACXN1Ym1pdHRlcgAAAAAAABIAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAPAAAACXRpbWVzdGFtcAAAAAAAAAUAAAAAAAAAAAAAAA8AAAAHdmVyc2lvbgAAAAADAAAAAQ==",
  submitted_v2: "AAAAEQAAAAEAAAAHAAAADwAAAAxtaWxlc3RvbmVfaWQAAAAOAAAAJGI4MWU0ZjA3LTZhMmMtNGQ5My04ZTVmLTBjN2E5YjNkMmU2MQAAAA8AAAAKcHJvamVjdF9pZAAAAAAADgAAACQzZjZjMmExZS04YjRkLTRjN2UtOWExMC0yZDViN2U5ZjFjMzQAAAAPAAAACnByb29mX2hhc2gAAAAAAA0AAAAgAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMAAAAPAAAABnN0YXR1cwAAAAAAEAAAAAEAAAABAAAADwAAAAlTdWJtaXR0ZWQAAAAAAAAPAAAACXN1Ym1pdHRlcgAAAAAAABIAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAPAAAACXRpbWVzdGFtcAAAAAAAAAUAAAAAAAAAAAAAAA8AAAAHdmVyc2lvbgAAAAADAAAAAg==",
  approved_v2: "AAAAEQAAAAEAAAAHAAAADwAAAAxtaWxlc3RvbmVfaWQAAAAOAAAAJGI4MWU0ZjA3LTZhMmMtNGQ5My04ZTVmLTBjN2E5YjNkMmU2MQAAAA8AAAAKcHJvamVjdF9pZAAAAAAADgAAACQzZjZjMmExZS04YjRkLTRjN2UtOWExMC0yZDViN2U5ZjFjMzQAAAAPAAAACnByb29mX2hhc2gAAAAAAA0AAAAgAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMAAAAPAAAABnN0YXR1cwAAAAAAEAAAAAEAAAABAAAADwAAAAhBcHByb3ZlZAAAAA8AAAAJc3VibWl0dGVyAAAAAAAAEgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAA8AAAAJdGltZXN0YW1wAAAAAAAABQAAAAAAAAAAAAAADwAAAAd2ZXJzaW9uAAAAAAMAAAAC",
  rejected_v2: "AAAAEQAAAAEAAAAHAAAADwAAAAxtaWxlc3RvbmVfaWQAAAAOAAAAJGI4MWU0ZjA3LTZhMmMtNGQ5My04ZTVmLTBjN2E5YjNkMmU2MQAAAA8AAAAKcHJvamVjdF9pZAAAAAAADgAAACQzZjZjMmExZS04YjRkLTRjN2UtOWExMC0yZDViN2U5ZjFjMzQAAAAPAAAACnByb29mX2hhc2gAAAAAAA0AAAAgAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMAAAAPAAAABnN0YXR1cwAAAAAAEAAAAAEAAAABAAAADwAAAAhSZWplY3RlZAAAAA8AAAAJc3VibWl0dGVyAAAAAAAAEgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAAAA8AAAAJdGltZXN0YW1wAAAAAAAABQAAAAAAAAAAAAAADwAAAAd2ZXJzaW9uAAAAAAMAAAAC",
  submitted_v3: "AAAAEQAAAAEAAAAHAAAADwAAAAxtaWxlc3RvbmVfaWQAAAAOAAAAJGI4MWU0ZjA3LTZhMmMtNGQ5My04ZTVmLTBjN2E5YjNkMmU2MQAAAA8AAAAKcHJvamVjdF9pZAAAAAAADgAAACQzZjZjMmExZS04YjRkLTRjN2UtOWExMC0yZDViN2U5ZjFjMzQAAAAPAAAACnByb29mX2hhc2gAAAAAAA0AAAAgBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUAAAAPAAAABnN0YXR1cwAAAAAAEAAAAAEAAAABAAAADwAAAAlTdWJtaXR0ZWQAAAAAAAAPAAAACXN1Ym1pdHRlcgAAAAAAABIAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAAPAAAACXRpbWVzdGFtcAAAAAAAAAUAAAAAAAAAAAAAAA8AAAAHdmVyc2lvbgAAAAADAAAAAw=="
};


/** What Soroban RPC sends for a failed simulation, with the host's error first. */
const notFound = (code: 2 | 3 | 6) =>
  `HostError: Error(Contract, #${code})\n\nEvent log (newest first):\n   0: [Diagnostic Event] topics:[error, Error(Contract, #${code})]`;

type Reply = { retval: string } | { error: string } | { status: number } | "throw" | "hang";

/** One JSON-RPC simulateTransaction answer per contract method. */
function rpcReplies(replies: { get_document: Reply; get_node: Reply; get_milestone_status?: Reply }) {
  const calls: { url: string; method: string; contract: string; args: string[] }[] = [];

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body));
    expect(body.method).toBe("simulateTransaction");

    const envelope = xdr.TransactionEnvelope.fromXDR(body.params.transaction, "base64");
    const op = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp();
    const call = op.hostFunction().invokeContract();
    const method = call.functionName().toString();
    calls.push({
      url,
      method,
      contract: Address.fromScAddress(call.contractAddress()).toString(),
      args: call.args().map((a) => a.toXDR("base64")),
    });

    const reply = replies[method as keyof typeof replies];
    if (!reply) throw new Error(`unexpected ${method}`);
    if (reply === "throw") throw new TypeError("fetch failed");
    if (reply === "hang") return new Promise<Response>(() => {});
    if ("status" in reply) return new Response("bad gateway", { status: reply.status });

    const result =
      "retval" in reply
        ? {
            latestLedger: 100,
            minResourceFee: "100",
            transactionData: new SorobanDataBuilder().build().toXDR("base64"),
            results: [{ auth: [], xdr: reply.retval }],
            cost: { cpuInsns: "0", memBytes: "0" },
          }
        : { latestLedger: 100, error: reply.error, events: [] };

    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const CONFIG = { network: "testnet" as const, contractId: REGISTRY, rpcUrl: "https://rpc.example.test" };
const CONTEXT: DocSourceContext = {
  milestoneId: MILESTONE,
  project: { id: PROJECT, network: "testnet", contractId: PROOF_CONTRACT },
};
const ENV = {
  DOQTRI_REGISTRY_CONTRACT_ID: REGISTRY,
  DOQTRI_REGISTRY_NETWORK: "testnet",
  DOQTRI_REGISTRY_RPC_URL: "https://rpc.example.test",
};
const REF_V2 = `qdit:testnet:${PROOF_CONTRACT}:${PROJECT}/${MILESTONE}@v2`;

beforeEach(() => {
  clearRegistryCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("decoding the registry's XDR", () => {
  it("decodes a Document", () => {
    expect(decodeDocument(xdr.ScVal.fromXDR(XDR.document, "base64"))).toEqual({
      owner: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
      contentHash: "03".repeat(32),
      version: 3,
      nodeCount: 2,
      updatedAt: 1792843200,
    });
  });

  it("decodes a NodeRecord and its unit-enum status", () => {
    expect(decodeNode(xdr.ScVal.fromXDR(XDR.nodeQdit, "base64"))).toEqual({
      status: "Verified",
      tool: "qdit",
      artifactRef: `qdit:testnet:${PROOF_CONTRACT}:3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34/${MILESTONE}@v2`,
      updatedAt: 1792843200,
    });
    expect(decodeNode(xdr.ScVal.fromXDR(XDR.nodeRollup, "base64"))).toMatchObject({
      status: "Built",
      tool: "rollup",
      artifactRef: "children:h3,h4",
    });
  });

  it("refuses a value of another shape rather than guessing", () => {
    // A NodeRecord is not a Document.
    expect(() => decodeDocument(xdr.ScVal.fromXDR(XDR.nodeQdit, "base64"))).toThrow(/get_document/);
    expect(() => decodeNode(xdr.ScVal.fromXDR(XDR.document, "base64"))).toThrow(/get_node/);
  });
});

describe("readRegistry", () => {
  it("simulates get_document(doc_id) and get_node(doc_id, node_id) with ScString arguments", async () => {
    const { calls } = rpcReplies({ get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } });

    const read = await readRegistry(CONFIG, DOC_ID, "h4");

    expect(read).toMatchObject({ ok: true, document: { version: 3 }, node: { status: "Verified", tool: "qdit" } });
    expect(calls.map((c) => c.url)).toEqual(["https://rpc.example.test/", "https://rpc.example.test/"]);
    expect(calls.find((c) => c.method === "get_document")?.args).toEqual([XDR.docIdArg]);
    expect(calls.find((c) => c.method === "get_node")?.args).toEqual([XDR.docIdArg, XDR.nodeIdArg]);
  });

  it("reads DocumentNotFound (#2) and NodeNotFound (#3) as no record", async () => {
    rpcReplies({ get_document: { error: notFound(2) }, get_node: { error: notFound(3) } });

    await expect(readRegistry(CONFIG, DOC_ID, "h4")).resolves.toEqual({ ok: true, document: null, node: null });
  });

  it("fails on any other contract error, never reading it as not found", async () => {
    rpcReplies({ get_document: { error: notFound(3) }, get_node: { retval: XDR.nodeQdit } });

    await expect(readRegistry(CONFIG, DOC_ID, "h4")).resolves.toEqual({ ok: false, reason: "rpc" });
  });

  it("fails when the RPC is unreachable or answers with an HTTP error", async () => {
    rpcReplies({ get_document: "throw", get_node: { retval: XDR.nodeQdit } });
    await expect(readRegistry(CONFIG, DOC_ID, "h4")).resolves.toEqual({ ok: false, reason: "rpc" });

    rpcReplies({ get_document: { retval: XDR.document }, get_node: { status: 502 } });
    await expect(readRegistry(CONFIG, DOC_ID, "h4")).resolves.toEqual({ ok: false, reason: "rpc" });
  });

  it("gives up on an RPC that does not answer", async () => {
    vi.useFakeTimers();
    rpcReplies({ get_document: "hang", get_node: "hang" });

    const pending = readRegistry(CONFIG, DOC_ID, "h4");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("fails on a reply that does not decode as the contract's type", async () => {
    rpcReplies({ get_document: { retval: XDR.nodeQdit }, get_node: { retval: XDR.nodeQdit } });

    await expect(readRegistry(CONFIG, DOC_ID, "h4")).resolves.toEqual({ ok: false, reason: "decode" });
  });
});

describe("decoding milestone_proof's XDR", () => {
  it("decodes a MilestoneRecord's status, version, proof hash, submitter and time", () => {
    const decode = (b64: string) => decodeMilestone(xdr.ScVal.fromXDR(b64, "base64"));
    // The test host's ledger clock starts at 0 and its submitter is a contract address.
    const fields = (fill: string) => ({ proofHash: fill.repeat(32), submitter: SUBMITTER, timestamp: 0 });
    expect(decode(RECORD.submitted_v1)).toEqual({ status: "Submitted", version: 1, ...fields("01") });
    expect(decode(RECORD.approved_v2)).toEqual({ status: "Approved", version: 2, ...fields("03") });
    expect(decode(RECORD.rejected_v2)).toEqual({ status: "Rejected", version: 2, ...fields("03") });
    expect(decode(RECORD.submitted_v3)).toEqual({ status: "Submitted", version: 3, ...fields("05") });
  });

  it("refuses a registry record in its place", () => {
    expect(() => decodeMilestone(xdr.ScVal.fromXDR(XDR.nodeQdit, "base64"))).toThrow(/get_milestone_status/);
    expect(() => decodeMilestone(xdr.ScVal.fromXDR(XDR.document, "base64"))).toThrow(/get_milestone_status/);
  });
});

describe("readMilestone", () => {
  const TARGET = { network: "testnet" as const, contractId: PROOF_CONTRACT, rpcUrl: "https://rpc.example.test" };

  it("simulates get_milestone_status(project_id, milestone_id) on the project's contract", async () => {
    const { calls } = rpcReplies({ get_document: "throw", get_node: "throw", get_milestone_status: { retval: RECORD.approved_v2 } });

    await expect(readMilestone(TARGET, PROJECT, MILESTONE)).resolves.toEqual({
      ok: true,
      record: { status: "Approved", version: 2, proofHash: "03".repeat(32), submitter: SUBMITTER, timestamp: 0 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].contract).toBe(PROOF_CONTRACT);
    expect(calls[0].args).toEqual([
      xdr.ScVal.scvString(PROJECT).toXDR("base64"),
      xdr.ScVal.scvString(MILESTONE).toXDR("base64"),
    ]);
  });

  it("reads MilestoneNotFound (#3) as no record, and any other failure as a failure", async () => {
    rpcReplies({ get_document: "throw", get_node: "throw", get_milestone_status: { error: notFound(3) } });
    await expect(readMilestone(TARGET, PROJECT, MILESTONE)).resolves.toEqual({ ok: true, record: null });

    rpcReplies({ get_document: "throw", get_node: "throw", get_milestone_status: { error: notFound(6) } });
    await expect(readMilestone(TARGET, PROJECT, MILESTONE)).resolves.toEqual({ ok: false, reason: "rpc" });

    rpcReplies({ get_document: "throw", get_node: "throw", get_milestone_status: "throw" });
    await expect(readMilestone(TARGET, PROJECT, MILESTONE)).resolves.toEqual({ ok: false, reason: "rpc" });

    rpcReplies({ get_document: "throw", get_node: "throw", get_milestone_status: { retval: XDR.nodeQdit } });
    await expect(readMilestone(TARGET, PROJECT, MILESTONE)).resolves.toEqual({ ok: false, reason: "decode" });
  });
});

describe("registryConfig", () => {
  it("reads the pair's one registry, its network and the RPC override (contract section 1)", () => {
    expect(registryConfig(ENV)).toEqual(CONFIG);
    expect(registryConfig({ DOQTRI_REGISTRY_CONTRACT_ID: REGISTRY, DOQTRI_REGISTRY_NETWORK: "testnet" })).toEqual({
      ...CONFIG,
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
    expect(registryConfig({ DOQTRI_REGISTRY_CONTRACT_ID: REGISTRY, DOQTRI_REGISTRY_NETWORK: "mainnet" })).toEqual({
      network: "mainnet",
      contractId: REGISTRY,
      rpcUrl: "https://mainnet.sorobanrpc.com",
    });
  });

  it("is null when unset, and when a value is malformed or the network is missing", () => {
    expect(registryConfig({})).toBeNull();
    expect(registryConfig({ DOQTRI_REGISTRY_NETWORK: "testnet" })).toBeNull();
    expect(registryConfig({ DOQTRI_REGISTRY_CONTRACT_ID: REGISTRY })).toBeNull();
    expect(registryConfig({ ...ENV, DOQTRI_REGISTRY_NETWORK: "public" })).toBeNull();
    expect(registryConfig({ ...ENV, DOQTRI_REGISTRY_CONTRACT_ID: "not-a-contract" })).toBeNull();
    expect(registryConfig({ ...ENV, DOQTRI_REGISTRY_RPC_URL: "http://rpc.example.test" })).toBeNull();
    // The per-network names this WP first used are not read.
    expect(registryConfig({ DOQTRI_REGISTRY_CONTRACT_ID_TESTNET: REGISTRY })).toBeNull();
  });
});

describe("parseQditArtifactRef", () => {
  it("splits contract section 10's grammar", () => {
    expect(
      parseQditArtifactRef(`qdit:testnet:${PROOF_CONTRACT}:3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34/${MILESTONE}@v2`),
    ).toEqual({
      network: "testnet",
      contractId: PROOF_CONTRACT,
      projectId: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
      milestoneId: MILESTONE,
      version: 2,
    });
  });

  it("refuses anything off the grammar", () => {
    const ok = `qdit:testnet:${PROOF_CONTRACT}:3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34/${MILESTONE}`;
    expect(parseQditArtifactRef(`${ok}@v0`)).toBeNull();
    expect(parseQditArtifactRef(`${ok}@v02`)).toBeNull();
    expect(parseQditArtifactRef(`${ok}@v4294967296`)).toBeNull();
    expect(parseQditArtifactRef(`${ok.toUpperCase()}@v2`)).toBeNull();
    expect(parseQditArtifactRef(`${ok.replace("testnet", "futurenet")}@v2`)).toBeNull();
    expect(parseQditArtifactRef("children:h3,h4")).toBeNull();
  });
});

describe("docVerdict (contract section 12, fact 1)", () => {
  const verdict = (docVersion: number | null, chain: number | null) =>
    docVerdict({ docId: DOC_ID, nodeId: "h4", docVersion }, chain);

  it("verified when the document is on chain at or past the stored version", () => {
    expect(verdict(3, 3)).toBe("verified");
    expect(verdict(2, 3)).toBe("verified");
  });

  it("not-anchored for a link with no version, whatever the chain holds", () => {
    expect(verdict(null, null)).toBe("not-anchored");
    expect(verdict(null, 3)).toBe("not-anchored");
  });

  it("not-found without a document, mismatch when the chain is behind", () => {
    expect(verdict(3, null)).toBe("not-found");
    expect(verdict(4, 3)).toBe("mismatch");
  });
});

describe("nodeAttestation (contract section 12, fact 4)", () => {
  const node = (fields: Partial<RegistryNode> = {}): RegistryNode => ({
    status: "Verified",
    tool: "qdit",
    artifactRef: REF_V2,
    updatedAt: 0,
    ...fields,
  });
  const record = (b64: keyof typeof RECORD): MilestoneRead => ({
    ok: true,
    record: decodeMilestone(xdr.ScVal.fromXDR(RECORD[b64], "base64")),
  });

  it("Verified at v2 with the milestone Approved at v2: fact 4", () => {
    const attestation = nodeAttestation(node(), CONTEXT, record("approved_v2"));
    expect(attestation).toEqual({ state: "current", status: "Verified", signedVersion: 2, milestoneStatus: "Approved" });
    expect(verifiedOnChain(attestation)).toBe(true);
  });

  it("Verified at v2 while the milestone is Rejected or only Submitted at v2: not verified", () => {
    for (const r of ["rejected_v2", "submitted_v2"] as const) {
      const attestation = nodeAttestation(node(), CONTEXT, record(r));
      expect(attestation).toMatchObject({ state: "current", status: "Verified", signedVersion: 2 });
      expect(verifiedOnChain(attestation)).toBe(false);
    }
  });

  it("resubmitted: the record is past the version the node names", () => {
    const attestation = nodeAttestation(node(), CONTEXT, record("submitted_v3"));
    expect(attestation).toEqual({
      state: "resubmitted",
      status: "Verified",
      signedVersion: 2,
      chainVersion: 3,
      milestoneStatus: "Submitted",
    });
    expect(verifiedOnChain(attestation)).toBe(false);
  });

  it("inconsistent: the record is older than the node's version, or missing", () => {
    expect(nodeAttestation(node(), CONTEXT, record("submitted_v1"))).toEqual({
      state: "inconsistent",
      status: "Verified",
      signedVersion: 2,
      reason: "older",
      chainVersion: 1,
    });
    expect(nodeAttestation(node(), CONTEXT, { ok: true, record: null })).toMatchObject({
      state: "inconsistent",
      reason: "not-found",
    });
  });

  it("inconsistent: the reference names this project and milestone on another network or contract", () => {
    const mainnet = REF_V2.replace("qdit:testnet:", "qdit:mainnet:");
    expect(nodeAttestation(node({ artifactRef: mainnet }), CONTEXT, null)).toMatchObject({
      state: "inconsistent",
      reason: "network",
    });
    const otherContract = REF_V2.replace(PROOF_CONTRACT, REGISTRY);
    expect(nodeAttestation(node({ artifactRef: otherContract }), CONTEXT, null)).toMatchObject({
      state: "inconsistent",
      reason: "contract",
    });
    // A project with no registration has no record that could back a signature.
    expect(nodeAttestation(node(), { ...CONTEXT, project: null }, null)).toMatchObject({
      state: "inconsistent",
      reason: "no-chain",
    });
  });

  it("unchecked when the milestone's record could not be read: never verified", () => {
    const attestation = nodeAttestation(node(), CONTEXT, { ok: false, reason: "timeout" });
    expect(attestation).toEqual({ state: "unchecked", status: "Verified", signedVersion: 2 });
    expect(verifiedOnChain(attestation)).toBe(false);
  });

  it("elsewhere when the reference names another project or milestone, or does not parse", () => {
    const otherProject = REF_V2.replace(`${PROJECT}/`, `${OTHER_UUID}/`);
    expect(nodeAttestation(node({ artifactRef: otherProject }), CONTEXT, null)).toEqual({
      state: "elsewhere",
      status: "Verified",
    });
    const otherMilestone = REF_V2.replace(`/${MILESTONE}`, `/${OTHER_UUID}`);
    expect(nodeAttestation(node({ artifactRef: otherMilestone }), CONTEXT, null)).toMatchObject({ state: "elsewhere" });
    expect(nodeAttestation(node({ artifactRef: "garbage" }), CONTEXT, null)).toMatchObject({ state: "elsewhere" });
  });

  it("other for another tool, none for no record", () => {
    expect(nodeAttestation(node({ tool: "rollup", artifactRef: "children:h3" }), CONTEXT, null)).toEqual({
      state: "other",
      status: "Verified",
      tool: "rollup",
    });
    expect(nodeAttestation(null, CONTEXT, null)).toEqual({ state: "none" });
  });

  it("asks for a milestone read only for a reference that could be this project's record", () => {
    expect(milestoneToRead(node(), CONTEXT)).toEqual({
      network: "testnet",
      contractId: PROOF_CONTRACT,
      projectId: PROJECT,
      milestoneId: MILESTONE,
    });
    expect(milestoneToRead(node({ artifactRef: REF_V2.replace(`${PROJECT}/`, `${OTHER_UUID}/`) }), CONTEXT)).toBeNull();
    expect(milestoneToRead(node({ artifactRef: REF_V2.replace(PROOF_CONTRACT, REGISTRY) }), CONTEXT)).toBeNull();
    expect(milestoneToRead(node(), { ...CONTEXT, project: null })).toBeNull();
    expect(milestoneToRead(node({ tool: "rollup" }), CONTEXT)).toBeNull();
    expect(milestoneToRead(null, CONTEXT)).toBeNull();
  });
});

describe("namesThisMilestone and plannedVerdict (contract section 12, both checks)", () => {
  const CHECK: DocSourceCheck = {
    state: "verified",
    network: "testnet",
    registryId: REGISTRY,
    chainVersion: 3,
    docUpdatedAt: 1792843200,
    node: { state: "current", status: "Verified", signedVersion: 2, milestoneStatus: "Approved" },
    nodeUpdatedAt: 1792843200,
  };
  const inconsistent = (reason: "no-chain" | "network" | "contract" | "not-found" | "older"): NodeAttestation => ({
    state: "inconsistent",
    status: "Verified",
    signedVersion: 2,
    reason,
    chainVersion: null,
  });

  it("node evidence: a record naming this project and milestone, and only that", () => {
    const evidence: NodeAttestation[] = [
      CHECK.node!,
      { state: "resubmitted", status: "Built", signedVersion: 2, chainVersion: 3, milestoneStatus: "Submitted" },
      { state: "unchecked", status: "Built", signedVersion: 2 },
      inconsistent("not-found"),
      inconsistent("older"),
    ];
    for (const node of evidence) expect(namesThisMilestone(node)).toBe(true);

    const none: (NodeAttestation | null)[] = [
      null,
      { state: "none" },
      { state: "other", status: "Built", tool: "rollup" },
      { state: "elsewhere", status: "Verified" },
      // The project id was never compared.
      inconsistent("no-chain"),
      // D-74: a reference to another chain does not point at this project's records.
      inconsistent("network"),
      inconsistent("contract"),
    ];
    for (const node of none) expect(namesThisMilestone(node)).toBe(false);
  });

  it("a reference to another network or contract is the inconsistent verdict, never unsigned or verified (D-74)", () => {
    for (const reason of ["network", "contract", "not-found", "older"] as const) {
      expect(plannedVerdict({ ...CHECK, node: inconsistent(reason) })).toBe("inconsistent");
    }
    expect(plannedVerdict({ ...CHECK, node: inconsistent("no-chain") })).toBe("no-chain");
  });

  it("unavailable when the node id could not be looked up (D-77)", () => {
    expect(plannedVerdict({ ...CHECK, state: "unavailable", chainVersion: null, node: null })).toBe("unavailable");
  });

  it("verified only when the node evidence holds, lines up, and the doc is anchored", () => {
    expect(plannedVerdict(CHECK)).toBe("verified");
    expect(
      plannedVerdict({
        ...CHECK,
        node: { state: "resubmitted", status: "Built", signedVersion: 2, chainVersion: 3, milestoneStatus: "Submitted" },
      }),
    ).toBe("verified");
    // Fact 4 is its own line: a node not yet Verified is still planned there.
    expect(plannedVerdict({ ...CHECK, node: { state: "current", status: "Planned", signedVersion: 2, milestoneStatus: "Submitted" } })).toBe(
      "verified",
    );
  });

  it("the doc anchor alone is never verified", () => {
    expect(plannedVerdict({ ...CHECK, node: { state: "none" } })).toBe("unsigned");
    expect(plannedVerdict({ ...CHECK, node: { state: "other", status: "Built", tool: "rollup" } })).toBe("unsigned");
    expect(plannedVerdict({ ...CHECK, node: { state: "elsewhere", status: "Verified" } })).toBe("unsigned");
    expect(plannedVerdict({ ...CHECK, node: inconsistent("no-chain") })).toBe("no-chain");
    expect(plannedVerdict({ ...CHECK, node: inconsistent("contract") })).toBe("inconsistent");
    expect(plannedVerdict({ ...CHECK, node: { state: "unchecked", status: "Verified", signedVersion: 2 } })).toBe("unchecked");
  });

  it("node evidence with a failing doc anchor is not verified", () => {
    for (const state of ["not-anchored", "not-found", "mismatch"] as const) {
      expect(plannedVerdict({ ...CHECK, state })).toBe("doc");
    }
    // An unread milestone record does not hide a failing doc anchor.
    expect(plannedVerdict({ ...CHECK, state: "mismatch", node: { state: "unchecked", status: "Built", signedVersion: 2 } })).toBe(
      "doc",
    );
  });

  it("a registry that was not read is could-not-check", () => {
    expect(plannedVerdict({ ...CHECK, state: "unreachable", node: null })).toBe("unreachable");
    expect(plannedVerdict({ ...CHECK, state: "unconfigured", node: null })).toBe("unconfigured");
  });
});

describe("compareDocSource", () => {
  const stored = (docVersion: number | null) => ({ docId: DOC_ID, nodeId: "h4", docVersion });
  const doc = (version: number) => ({ owner: "G", contentHash: "00", version, nodeCount: 1, updatedAt: 0 });

  it("reports the registry it read, the chain version and the node", () => {
    const read: RegistryRead = { ok: true, document: doc(3), node: null };
    expect(compareDocSource(stored(3), read, CONTEXT, CONFIG)).toEqual({
      state: "verified",
      network: "testnet",
      registryId: REGISTRY,
      chainVersion: 3,
      docUpdatedAt: 0,
      node: { state: "none" },
      nodeUpdatedAt: null,
    });
  });

  it("unreachable when the read failed, whatever was stored", () => {
    expect(compareDocSource(stored(3), { ok: false, reason: "rpc" }, CONTEXT, CONFIG)).toEqual({
      state: "unreachable",
      network: "testnet",
      registryId: REGISTRY,
      chainVersion: null,
      docUpdatedAt: null,
      node: null,
      nodeUpdatedAt: null,
    });
  });
});

describe("checkDocSource", () => {
  const STORED = { docId: DOC_ID, nodeId: "h4", docVersion: 3 };
  const ALL = { get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } };

  it("is unconfigured, and reads nothing, without a registry", async () => {
    const { fetchMock } = rpcReplies(ALL);

    await expect(checkDocSource(STORED, CONTEXT, { env: {} })).resolves.toEqual({
      state: "unconfigured",
      network: null,
      registryId: null,
      chainVersion: null,
      docUpdatedAt: null,
      node: null,
      nodeUpdatedAt: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the plan on the registry and the node against the project's milestone_proof", async () => {
    const { calls } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });

    await expect(checkDocSource(STORED, CONTEXT, { env: ENV })).resolves.toEqual({
      state: "verified",
      network: "testnet",
      registryId: REGISTRY,
      chainVersion: 3,
      docUpdatedAt: 1792843200,
      node: { state: "current", status: "Verified", signedVersion: 2, milestoneStatus: "Approved" },
      nodeUpdatedAt: 1792843200,
    });
    expect(calls.map((c) => [c.method, c.contract])).toEqual(
      expect.arrayContaining([
        ["get_document", REGISTRY],
        ["get_node", REGISTRY],
        ["get_milestone_status", PROOF_CONTRACT],
      ]),
    );
    // The milestone read goes to the project's network, not the override for the registry.
    expect(calls.find((c) => c.method === "get_milestone_status")?.url).toBe("https://soroban-testnet.stellar.org/");
  });

  it("reads the registry on its own network, whatever the project's", async () => {
    // A mainnet project planned in a doc doqtri anchors on testnet.
    const mainnetProject: DocSourceContext = {
      milestoneId: MILESTONE,
      project: { id: PROJECT, network: "mainnet", contractId: PROOF_CONTRACT },
    };
    const { calls } = rpcReplies(ALL);

    await expect(checkDocSource(STORED, mainnetProject, { env: ENV })).resolves.toMatchObject({
      state: "verified",
      network: "testnet",
      // The node's testnet reference cannot be this mainnet project's record.
      node: { state: "inconsistent", reason: "network" },
    });
    expect(calls.map((c) => c.method).sort()).toEqual(["get_document", "get_node"]);
  });

  it("never verifies a node whose milestone record could not be read", async () => {
    rpcReplies({ ...ALL, get_milestone_status: "throw" });

    await expect(checkDocSource(STORED, CONTEXT, { env: ENV })).resolves.toMatchObject({
      state: "verified",
      node: { state: "unchecked", status: "Verified" },
    });
  });

  it("reuses an answer for 30 seconds, then reads again", async () => {
    const { fetchMock } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });
    let now = 1_000_000;
    const options = { env: ENV, now: () => now };

    await checkDocSource(STORED, CONTEXT, options);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Cached reads are compared afresh: another stored version, another state.
    now += CACHE_TTL_MS - 1;
    await expect(checkDocSource({ ...STORED, docVersion: 4 }, CONTEXT, options)).resolves.toMatchObject({
      state: "mismatch",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    now += 1;
    await checkDocSource(STORED, CONTEXT, options);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("keeps a failure for 5 seconds only, and never as verified", async () => {
    rpcReplies({ get_document: "throw", get_node: "throw" });
    let now = 1_000_000;
    const options = { env: ENV, now: () => now };

    await expect(checkDocSource(STORED, CONTEXT, options)).resolves.toMatchObject({ state: "unreachable" });

    const { fetchMock } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });
    now += FAILURE_TTL_MS - 1;
    await expect(checkDocSource(STORED, CONTEXT, options)).resolves.toMatchObject({ state: "unreachable" });
    expect(fetchMock).not.toHaveBeenCalled();

    now += 1;
    await expect(checkDocSource(STORED, CONTEXT, options)).resolves.toMatchObject({ state: "verified" });
  });

  it("forgets a read that rejected, so the next caller of the key reads again", async () => {
    const { fetchMock } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });
    const options = { env: ENV, now: () => 1_000_000 };

    // The readers catch everything, so only a regression makes one reject. A
    // doc id that is not a string does: nativeToScVal throws before the
    // read's own try. The cache key is the same as the string's.
    await expect(checkDocSource({ ...STORED, docId: 123 as unknown as string }, CONTEXT, options)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(checkDocSource({ ...STORED, docId: "123" }, CONTEXT, options)).resolves.toMatchObject({
      state: "verified",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reads nothing, and says so, when the node id could not be looked up (D-77)", async () => {
    const { fetchMock } = rpcReplies(ALL);

    await expect(checkDocSource({ ...STORED, nodeId: null }, CONTEXT, { env: ENV })).resolves.toEqual({
      state: "unavailable",
      network: "testnet",
      registryId: REGISTRY,
      chainVersion: null,
      docUpdatedAt: null,
      node: null,
      nodeUpdatedAt: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkMilestoneRecord (WP-3.3, facts 2 and 3)", () => {
  const STORED = { docId: DOC_ID, nodeId: "h4", docVersion: 3 };
  const ALL = { get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } };
  const PROJECT_TARGET = { id: PROJECT, network: "testnet" as const, contractId: PROOF_CONTRACT };

  it("reads the milestone's current record on the project's own contract and network", async () => {
    const { calls } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });

    await expect(checkMilestoneRecord(PROJECT_TARGET, MILESTONE)).resolves.toMatchObject({
      ok: true,
      record: { status: "Approved", version: 2 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "get_milestone_status",
      contract: PROOF_CONTRACT,
      url: "https://soroban-testnet.stellar.org/",
    });
  });

  it("shares one request with the heading check when the page asks for both at once", async () => {
    const { calls } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });

    const [record, check] = await Promise.all([
      checkMilestoneRecord(PROJECT_TARGET, MILESTONE),
      checkDocSource(STORED, CONTEXT, { env: ENV }),
    ]);

    expect(record).toMatchObject({ ok: true, record: { status: "Approved" } });
    expect(check.node).toMatchObject({ state: "current", milestoneStatus: "Approved" });
    expect(calls.filter((c) => c.method === "get_milestone_status")).toHaveLength(1);
  });

  it("caches an answer for 30 seconds and a failure for 5, and never throws", async () => {
    rpcReplies({ ...ALL, get_milestone_status: "throw" });
    let now = 1_000_000;
    const options = { now: () => now };

    await expect(checkMilestoneRecord(PROJECT_TARGET, MILESTONE, options)).resolves.toEqual({ ok: false, reason: "rpc" });

    const { fetchMock } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.submitted_v1 } });
    now += FAILURE_TTL_MS - 1;
    await expect(checkMilestoneRecord(PROJECT_TARGET, MILESTONE, options)).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();

    now += 1;
    await expect(checkMilestoneRecord(PROJECT_TARGET, MILESTONE, options)).resolves.toMatchObject({ ok: true });
    now += CACHE_TTL_MS - 1;
    await checkMilestoneRecord(PROJECT_TARGET, MILESTONE, options);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("checkMilestoneRecord with fresh (D-97)", () => {
  const PROJECT_TARGET = { id: PROJECT, network: "testnet" as const, contractId: PROOF_CONTRACT };
  const ALL = { get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } };

  it("never reuses an ordinary cached read, and reuses a fresh one for FRESH_REUSE_MS", async () => {
    let now = 1_000_000;
    rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.submitted_v2 } });
    await checkMilestoneRecord(PROJECT_TARGET, MILESTONE, { now: () => now });

    const { fetchMock } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });
    now += 1_000;
    // Ordinary: the cached Submitted.
    await expect(checkMilestoneRecord(PROJECT_TARGET, MILESTONE, { now: () => now })).resolves.toMatchObject({
      record: { status: "Submitted" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // Fresh: read again, and the answer replaces the cached one.
    await expect(
      checkMilestoneRecord(PROJECT_TARGET, MILESTONE, { now: () => now, fresh: true }),
    ).resolves.toMatchObject({ record: { status: "Approved" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(checkMilestoneRecord(PROJECT_TARGET, MILESTONE, { now: () => now })).resolves.toMatchObject({
      record: { status: "Approved" },
    });

    now += FRESH_REUSE_MS - 1;
    await checkMilestoneRecord(PROJECT_TARGET, MILESTONE, { now: () => now, fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 1;
    await checkMilestoneRecord(PROJECT_TARGET, MILESTONE, { now: () => now, fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("readPublicChain: no contradiction from a cached record (D-97)", () => {
  const ALL = { get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } };
  const ANCHOR = {
    proofHash: null,
    version: 2,
    network: "testnet" as const,
    signerAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
    ledger: null,
  };
  const SUBMIT = { ...ANCHOR, action: "submit" as const, txHash: "a".repeat(64), createdAt: "2026-10-25T10:00:00.000Z" };
  const APPROVE = { ...ANCHOR, action: "approve" as const, txHash: "b".repeat(64), createdAt: "2026-10-25T10:00:20.000Z" };
  const PROOF: PublicProof = {
    projectName: "Soroban payroll",
    projectSlug: "soroban-payroll",
    milestoneId: MILESTONE,
    title: "Escrow contract",
    status: "submitted",
    dueDate: null,
    network: "testnet",
    contractId: PROOF_CONTRACT,
    registeredTx: null,
    ownerAddress: null,
    anchors: [SUBMIT],
    reviews: [],
    docSource: {
      docId: DOC_ID,
      nodeId: "h4",
      nodeLabel: "Escrow contract",
      docVersion: 3,
      docLink: null,
      projectId: PROJECT,
    },
  };
  const states = (chain: Awaited<ReturnType<typeof readPublicChain>>) => chain?.steps.map((s) => s.state);

  it("shows Done after a fresh read when the cached record is Submitted and qdit has a newer approve anchor", async () => {
    let now = 1_000_000;
    const options = { env: ENV, now: () => now };

    // A reader loads the page while v2 awaits a decision: that record is cached.
    rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.submitted_v2 } });
    await expect(readPublicChain(PROOF, options).then(states)).resolves.toEqual([
      "done",
      "done",
      "pending",
      "mismatch",
    ]);

    // The owner approves; qdit records the anchor. The reader reloads well
    // within the cache's 30 s.
    const { calls } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });
    now += 10_000;
    const chain = await readPublicChain({ ...PROOF, status: "approved", anchors: [SUBMIT, APPROVE] }, options);

    expect(states(chain)).toEqual(["done", "done", "done", "done"]);
    expect(chain?.steps[2].summary).toBe("v2 approved on Testnet by the project's registered owner.");
    expect(chain?.check.node).toMatchObject({ state: "current", milestoneStatus: "Approved" });
    // One fresh milestone read, shared by both checks; the registry stays cached.
    expect(calls.map((c) => c.method)).toEqual(["get_milestone_status"]);
  });

  it("still shows Does not match when a fresh read agrees, and does not bypass the cache on every reload", async () => {
    let now = 1_000_000;
    const options = { env: ENV, now: () => now };
    const contradicted = { ...PROOF, anchors: [SUBMIT, APPROVE] };

    const { calls } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.submitted_v2 } });
    const chain = await readPublicChain(contradicted, options);

    expect(chain?.steps[2]).toMatchObject({
      state: "mismatch",
      summary: "qdit recorded an approval of v2, but milestone_proof on Testnet says v2 awaits a decision.",
    });
    const milestoneReads = () => calls.filter((c) => c.method === "get_milestone_status").length;
    expect(milestoneReads()).toBe(2);

    now += FRESH_REUSE_MS - 1;
    await readPublicChain(contradicted, options);
    expect(milestoneReads()).toBe(2);

    now += 1;
    expect(states(await readPublicChain(contradicted, options))?.[2]).toBe("mismatch");
    expect(milestoneReads()).toBe(3);
  });

  it("reads nothing twice when nothing contradicts", async () => {
    const { calls } = rpcReplies({ ...ALL, get_milestone_status: { retval: RECORD.approved_v2 } });

    const chain = await readPublicChain({ ...PROOF, anchors: [SUBMIT, APPROVE] }, { env: ENV, now: () => 1_000_000 });

    expect(states(chain)).toEqual(["done", "done", "done", "done"]);
    expect(calls.map((c) => c.method).sort()).toEqual(["get_document", "get_milestone_status", "get_node"]);
  });

  it("is null for an unlinked milestone, and reads nothing", async () => {
    const { fetchMock } = rpcReplies(ALL);
    await expect(readPublicChain({ ...PROOF, docSource: undefined }, { env: ENV })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
