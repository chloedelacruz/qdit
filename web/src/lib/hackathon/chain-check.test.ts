import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/lib/api/hackathon-snapshot-body";
import type { DocumentRead, RegistryConfig, RegistryDocument } from "@/lib/chain/doqtri-registry";

import { CHAIN_CHECK_CONCURRENCY, checkNotesOnChain, recordChainCheck } from "./chain-check";

/**
 * The hackathon snapshot's chain check (contract section 8): each note's
 * markdown hash against DoqtriRegistry `get_document`, with a failed read
 * never counted as a match (D-93). The registry read itself is
 * `readRegistryDocument`, covered against real XDR in
 * `lib/chain/doqtri-registry.test.ts`; here it is a stub.
 */

const CONFIG: RegistryConfig = {
  network: "testnet",
  contractId: "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ",
  rpcUrl: "https://rpc.example.test",
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MATCHED = id(1);
const MISMATCH = id(2);
const NOT_ANCHORED = id(3);
const BROKEN = id(4);

const MARKDOWN = "# Payroll v1 plan\n\n## Escrow contract \u{1F680}\n";

const anchored = (contentHash: string): DocumentRead => ({
  ok: true,
  document: { owner: "G", contentHash, version: 3, nodeCount: 2, updatedAt: 0 } satisfies RegistryDocument,
});

function registry(reads: Record<string, DocumentRead | Error>) {
  return vi.fn(async (_config: RegistryConfig, docId: string): Promise<DocumentRead> => {
    const read = reads[docId];
    if (read instanceof Error) throw read;
    if (!read) throw new Error(`unexpected read of ${docId}`);
    return read;
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkNotesOnChain", () => {
  it("records matched, mismatch, not_anchored, and unchecked for a failed read", async () => {
    const read = registry({
      [MATCHED]: anchored(sha256Hex(MARKDOWN)),
      [MISMATCH]: anchored("ab".repeat(32)),
      [NOT_ANCHORED]: { ok: true, document: null },
      [BROKEN]: { ok: false, reason: "rpc" },
    });

    const check = await checkNotesOnChain(
      [MATCHED, MISMATCH, NOT_ANCHORED, BROKEN].map((doc_id) => ({ doc_id, markdown: MARKDOWN })),
      { config: CONFIG, read, now: () => Date.UTC(2026, 10, 20, 15, 5) },
    );

    expect(check).toEqual({
      checked_at: "2026-11-20T15:05:00.000Z",
      registry: { network: "testnet", contract_id: CONFIG.contractId },
      notes: {
        [MATCHED]: "matched",
        [MISMATCH]: "mismatch",
        [NOT_ANCHORED]: "not_anchored",
        [BROKEN]: "unchecked",
      },
    });
    expect(read.mock.calls.map(([config, docId]) => [config, docId])).toEqual(
      [MATCHED, MISMATCH, NOT_ANCHORED, BROKEN].map((docId) => [CONFIG, docId]),
    );
  });

  it("hashes the markdown's UTF-8 bytes exactly as sent: a trailing newline is a mismatch", async () => {
    const read = registry({ [MATCHED]: anchored(sha256Hex(MARKDOWN.trimEnd())) });
    const check = await checkNotesOnChain([{ doc_id: MATCHED, markdown: MARKDOWN }], { config: CONFIG, read });
    expect(check.notes[MATCHED]).toBe("mismatch");
  });

  it("compares hashes in lowercase hex", async () => {
    const read = registry({ [MATCHED]: anchored(sha256Hex(MARKDOWN).toUpperCase()) });
    const check = await checkNotesOnChain([{ doc_id: MATCHED, markdown: MARKDOWN }], { config: CONFIG, read });
    expect(check.notes[MATCHED]).toBe("matched");
  });

  it("records a read that throws, times out or does not decode as unchecked, never matched", async () => {
    const read = registry({
      [MATCHED]: new Error("boom"),
      [MISMATCH]: { ok: false, reason: "timeout" },
      [NOT_ANCHORED]: { ok: false, reason: "decode" },
    });
    const check = await checkNotesOnChain(
      [MATCHED, MISMATCH, NOT_ANCHORED].map((doc_id) => ({ doc_id, markdown: MARKDOWN })),
      { config: CONFIG, read },
    );
    expect(Object.values(check.notes)).toEqual(["unchecked", "unchecked", "unchecked"]);
  });

  it("records every note unchecked when no registry is configured, reading nothing", async () => {
    const read = registry({});
    const check = await checkNotesOnChain([{ doc_id: MATCHED, markdown: MARKDOWN }], { config: null, read });
    expect(check).toMatchObject({ registry: null, notes: { [MATCHED]: "unchecked" } });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads at most five at a time", async () => {
    let running = 0;
    let peak = 0;
    const read = vi.fn(async (): Promise<DocumentRead> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return { ok: true, document: null };
    });

    const notes = Array.from({ length: 23 }, (_, i) => ({ doc_id: id(100 + i), markdown: "" }));
    const check = await checkNotesOnChain(notes, { config: CONFIG, read });

    expect(CHAIN_CHECK_CONCURRENCY).toBe(5);
    expect(peak).toBe(5);
    expect(read).toHaveBeenCalledTimes(23);
    expect(Object.values(check.notes).every((state) => state === "not_anchored")).toBe(true);
  });

  it("starts no read past its time budget; the rest stay unchecked", async () => {
    let clock = 0;
    const read = vi.fn(async (): Promise<DocumentRead> => {
      clock += 10;
      return { ok: true, document: null };
    });
    const notes = Array.from({ length: 12 }, (_, i) => ({ doc_id: id(200 + i), markdown: "" }));

    const check = await checkNotesOnChain(notes, { config: CONFIG, read, now: () => clock, budgetMs: 25 });

    const states = Object.values(check.notes);
    expect(states.filter((s) => s === "not_anchored").length).toBe(read.mock.calls.length);
    expect(states.filter((s) => s === "unchecked").length).toBe(12 - read.mock.calls.length);
    expect(read.mock.calls.length).toBeLessThan(12);
  });
});

describe("recordChainCheck", () => {
  const STORED = "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f";

  it("stores the check on qdit's snapshot id through record_doqtri_chain_check", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const read = registry({ [MATCHED]: anchored(sha256Hex(MARKDOWN)) });

    await recordChainCheck(STORED, [{ doc_id: MATCHED, markdown: MARKDOWN }], {
      config: CONFIG,
      read,
      client: () => ({ rpc }) as never,
    });

    expect(rpc).toHaveBeenCalledWith("record_doqtri_chain_check", {
      p_snapshot_id: STORED,
      p_chain_check: expect.objectContaining({ notes: { [MATCHED]: "matched" } }),
    });
  });

  it("never throws: no secret key, a failed write and a throwing client are logged", async () => {
    const read = registry({ [MATCHED]: anchored(sha256Hex(MARKDOWN)) });
    const notes = [{ doc_id: MATCHED, markdown: MARKDOWN }];

    await expect(recordChainCheck(STORED, notes, { config: CONFIG, read, client: () => null })).resolves.toBeUndefined();

    const failing = vi.fn(async () => ({ data: null, error: { code: "P0002", message: "No such snapshot." } }));
    await expect(
      recordChainCheck(STORED, notes, { config: CONFIG, read, client: () => ({ rpc: failing }) as never }),
    ).resolves.toBeUndefined();

    await expect(
      recordChainCheck(STORED, notes, {
        config: CONFIG,
        read,
        client: () => {
          throw new Error("no url");
        },
      }),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledTimes(3);
  });
});
