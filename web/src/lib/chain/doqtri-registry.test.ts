import { SorobanDataBuilder, xdr } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_TTL_MS,
  FAILURE_TTL_MS,
  checkDocSource,
  clearRegistryCache,
  compareDocSource,
  decodeDocument,
  decodeNode,
  parseQditArtifactRef,
  readRegistry,
  registryConfig,
  type DocSourceContext,
  type RegistryRead,
} from "@/lib/chain/doqtri-registry";

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
 */

const DOC_ID = "c2d1e0f9-8a7b-4c6d-9e5f-4a3b2c1d0e9f";
const MILESTONE = "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61";
const PROOF_CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const REGISTRY = "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ";

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

/** What Soroban RPC sends for a failed simulation, with the host's error first. */
const notFound = (code: 2 | 3) =>
  `HostError: Error(Contract, #${code})\n\nEvent log (newest first):\n   0: [Diagnostic Event] topics:[error, Error(Contract, #${code})]`;

type Reply = { retval: string } | { error: string } | { status: number } | "throw" | "hang";

/** One JSON-RPC simulateTransaction answer per contract method. */
function rpcReplies(replies: { get_document: Reply; get_node: Reply }) {
  const calls: { url: string; method: string; args: string[] }[] = [];

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body));
    expect(body.method).toBe("simulateTransaction");

    const envelope = xdr.TransactionEnvelope.fromXDR(body.params.transaction, "base64");
    const op = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp();
    const call = op.hostFunction().invokeContract();
    const method = call.functionName().toString();
    calls.push({ url, method, args: call.args().map((a) => a.toXDR("base64")) });

    const reply = replies[method as keyof typeof replies];
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
const CONTEXT: DocSourceContext = { network: "testnet", milestoneId: MILESTONE, contractId: PROOF_CONTRACT };
const ENV = { DOQTRI_REGISTRY_CONTRACT_ID_TESTNET: REGISTRY, DOQTRI_REGISTRY_RPC_URL_TESTNET: "https://rpc.example.test" };

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

describe("registryConfig", () => {
  it("reads the per-network contract id and RPC override", () => {
    expect(registryConfig("testnet", ENV)).toEqual(CONFIG);
    expect(registryConfig("testnet", { DOQTRI_REGISTRY_CONTRACT_ID_TESTNET: REGISTRY })).toEqual({
      ...CONFIG,
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
    expect(registryConfig("mainnet", { DOQTRI_REGISTRY_CONTRACT_ID_MAINNET: REGISTRY })).toEqual({
      network: "mainnet",
      contractId: REGISTRY,
      rpcUrl: "https://mainnet.sorobanrpc.com",
    });
  });

  it("is null when unset, and when a value is malformed", () => {
    expect(registryConfig("testnet", {})).toBeNull();
    // The testnet id does not configure mainnet.
    expect(registryConfig("mainnet", ENV)).toBeNull();
    expect(registryConfig("testnet", { DOQTRI_REGISTRY_CONTRACT_ID_TESTNET: "not-a-contract" })).toBeNull();
    expect(
      registryConfig("testnet", { ...ENV, DOQTRI_REGISTRY_RPC_URL_TESTNET: "http://rpc.example.test" }),
    ).toBeNull();
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

describe("compareDocSource", () => {
  const read = (version: number | null, node: Partial<{ tool: string; artifactRef: string }> | null = {}) =>
    ({
      ok: true,
      document:
        version === null
          ? null
          : { owner: "G", contentHash: "00", version, nodeCount: 1, updatedAt: 0 },
      node:
        node === null
          ? null
          : {
              status: "Verified",
              tool: "qdit",
              artifactRef: `qdit:testnet:${PROOF_CONTRACT}:3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34/${MILESTONE}@v2`,
              updatedAt: 0,
              ...node,
            },
    }) as RegistryRead;
  const check = (docVersion: number | null, r: RegistryRead, context = CONTEXT) =>
    compareDocSource({ docId: DOC_ID, nodeId: "h4", docVersion }, r, context, REGISTRY);

  it("verified when the registry is at the stored version", () => {
    expect(check(3, read(3))).toEqual({
      state: "verified",
      network: "testnet",
      registryId: REGISTRY,
      chainVersion: 3,
      node: { state: "attests", status: "Verified", milestoneVersion: 2 },
    });
  });

  it("newer when the registry is past it, or anchored since an unversioned link", () => {
    expect(check(2, read(3))).toMatchObject({ state: "newer", chainVersion: 3 });
    expect(check(null, read(3))).toMatchObject({ state: "newer", chainVersion: 3 });
  });

  it("mismatch when the registry is behind the stored version", () => {
    expect(check(4, read(3))).toMatchObject({ state: "mismatch", chainVersion: 3 });
  });

  it("not-found for a stored version the registry has no document for; not-anchored when neither has one", () => {
    expect(check(3, read(null))).toMatchObject({ state: "not-found", chainVersion: null });
    expect(check(null, read(null, null))).toMatchObject({ state: "not-anchored", node: { state: "none" } });
  });

  it("unreachable when the read failed, whatever was stored", () => {
    expect(check(3, { ok: false, reason: "rpc" })).toEqual({
      state: "unreachable",
      network: "testnet",
      registryId: REGISTRY,
      chainVersion: null,
      node: null,
    });
  });

  it("names a heading record that is for another milestone, network or contract, or another tool", () => {
    const other = `qdit:testnet:${PROOF_CONTRACT}:3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34/00000000-0000-4000-8000-000000000000@v2`;
    expect(check(3, read(3, { artifactRef: other })).node).toEqual({ state: "elsewhere", status: "Verified" });
    expect(check(3, read(3), { ...CONTEXT, network: "mainnet" }).node).toMatchObject({ state: "elsewhere" });
    expect(check(3, read(3), { ...CONTEXT, contractId: REGISTRY }).node).toMatchObject({ state: "elsewhere" });
    expect(check(3, read(3, { artifactRef: "garbage" })).node).toMatchObject({ state: "elsewhere" });
    expect(check(3, read(3, { tool: "rollup", artifactRef: "children:h3" })).node).toEqual({
      state: "other",
      status: "Verified",
      tool: "rollup",
    });
    // A project not registered on milestone_proof yet: the contract is not compared.
    expect(check(3, read(3), { ...CONTEXT, contractId: null }).node).toMatchObject({ state: "attests" });
  });
});

describe("checkDocSource", () => {
  const STORED = { docId: DOC_ID, nodeId: "h4", docVersion: 3 };

  it("is unconfigured, and reads nothing, without a registry for the network", async () => {
    const { fetchMock } = rpcReplies({ get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } });

    await expect(checkDocSource(STORED, CONTEXT, { env: {} })).resolves.toEqual({
      state: "unconfigured",
      network: "testnet",
      registryId: null,
      chainVersion: null,
      node: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks against the chain end to end", async () => {
    rpcReplies({ get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } });

    await expect(checkDocSource(STORED, CONTEXT, { env: ENV })).resolves.toMatchObject({
      state: "verified",
      chainVersion: 3,
      node: { state: "attests", status: "Verified", milestoneVersion: 2 },
    });
  });

  it("reuses an answer for 30 seconds, then reads again", async () => {
    const { fetchMock } = rpcReplies({ get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } });
    let now = 1_000_000;
    const options = { env: ENV, now: () => now };

    await checkDocSource(STORED, CONTEXT, options);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Cached reads are compared afresh: another stored version, another state.
    now += CACHE_TTL_MS - 1;
    await expect(checkDocSource({ ...STORED, docVersion: 2 }, CONTEXT, options)).resolves.toMatchObject({
      state: "newer",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now += 1;
    await checkDocSource(STORED, CONTEXT, options);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps a failure for 5 seconds only, and never as verified", async () => {
    rpcReplies({ get_document: "throw", get_node: "throw" });
    let now = 1_000_000;
    const options = { env: ENV, now: () => now };

    await expect(checkDocSource(STORED, CONTEXT, options)).resolves.toMatchObject({ state: "unreachable" });

    const { fetchMock } = rpcReplies({ get_document: { retval: XDR.document }, get_node: { retval: XDR.nodeQdit } });
    now += FAILURE_TTL_MS - 1;
    await expect(checkDocSource(STORED, CONTEXT, options)).resolves.toMatchObject({ state: "unreachable" });
    expect(fetchMock).not.toHaveBeenCalled();

    now += 1;
    await expect(checkDocSource(STORED, CONTEXT, options)).resolves.toMatchObject({ state: "verified" });
  });
});
