// FakeChain behind a real HTTP JSON-RPC endpoint, so the CLI can be run as a
// child process against it with --rpc-url. Answers are encoded the way Soroban
// RPC encodes them (XDR as base64), so the SDK's own parsers run too.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Address, Networks, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk";
import type { FakeChain } from "./fake-rpc.ts";

const EMPTY_TX_DATA = new xdr.SorobanTransactionData({
  ext: new xdr.SorobanTransactionDataExt(0),
  resources: new xdr.SorobanResources({
    footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
    instructions: 0,
    diskReadBytes: 0,
    writeBytes: 0,
  }),
  resourceFee: xdr.Int64.fromString("0"),
}).toXDR("base64");

type Rpc = ReturnType<FakeChain["rpc"]> & Pick<rpc.Server, "getEvents" | "getLatestLedger" | "getHealth">;

async function answer(chain: FakeChain, method: string, params: Record<string, any>): Promise<unknown> {
  const r = chain.rpc() as Rpc;
  switch (method) {
    case "getNetwork":
      return r.getNetwork();
    case "getLatestLedger":
      return r.getLatestLedger();
    case "getHealth":
      return r.getHealth();
    case "getLedgerEntries": {
      const entries = [];
      for (const k of params.keys as string[]) {
        const key = xdr.LedgerKey.fromXDR(k, "base64");
        const id = Address.fromScAddress(key.contractData().contract()).toString();
        try {
          const { val } = await r.getContractData(id, xdr.ScVal.scvLedgerKeyContractInstance(), rpc.Durability.Persistent);
          entries.push({ key: k, xdr: val.toXDR("base64"), lastModifiedLedgerSeq: 1, liveUntilLedgerSeq: 10_000_000 });
        } catch {
          // Missing: the real RPC leaves it out.
        }
      }
      return { entries, latestLedger: chain.ledger };
    }
    case "simulateTransaction": {
      const tx = TransactionBuilder.fromXDR(params.transaction, Networks.TESTNET);
      const sim = (await r.simulateTransaction(tx as never)) as { error?: string; result?: { retval: xdr.ScVal } };
      if (sim.error) return { error: sim.error, latestLedger: chain.ledger };
      return {
        latestLedger: chain.ledger,
        minResourceFee: "0",
        transactionData: EMPTY_TX_DATA,
        results: [{ auth: [], xdr: sim.result!.retval.toXDR("base64") }],
      };
    }
    case "getEvents": {
      const req = params.pagination?.cursor
        ? { filters: params.filters, cursor: params.pagination.cursor, limit: params.pagination.limit }
        : { filters: params.filters, startLedger: params.startLedger, endLedger: params.endLedger, limit: params.pagination?.limit };
      const page = await r.getEvents(req as never);
      return {
        ...page,
        events: page.events.map((e) => ({
          ...e,
          contractId: e.contractId?.contractId() ?? "",
          topic: e.topic.map((t) => t.toXDR("base64")),
          value: e.value.toXDR("base64"),
        })),
      };
    }
    default:
      throw new Error(`fake RPC server: no ${method}`);
  }
}

export async function serve(chain: FakeChain): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const msg = JSON.parse(body) as { id: unknown; method: string; params: Record<string, unknown> };
      let reply: object;
      try {
        reply = { jsonrpc: "2.0", id: msg.id, result: await answer(chain, msg.method, msg.params ?? {}) };
      } catch (e) {
        reply = { jsonrpc: "2.0", id: msg.id, error: { code: -32600, message: e instanceof Error ? e.message : String(e) } };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}
