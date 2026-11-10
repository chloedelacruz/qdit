import { describe, expect, it, vi } from "vitest";

import { anchoredChain, doqtriSnapshot, qditSnapshot, TEAM, WINDOW } from "@/test/hackathon-fixtures";

import { ChainUnavailableError } from "./chain-facts";
import { checkEntry } from "./entry-check";
import { CHAIN_UNCHECKED_REASON } from "./entry-check-copy";

/** The pre-submit check (QDIT-55) over a `preview_hackathon_entry()` answer. */

const RECEIVED = "2026-11-20T02:42:10.000Z";

function preview(overrides: Record<string, unknown> = {}) {
  return {
    qdit_snapshot: qditSnapshot(),
    doqtri_snapshot: doqtriSnapshot(),
    doqtri_received_at: RECEIVED,
    doqtri_note_count: 5,
    ...overrides,
  };
}

function input(p: unknown = preview()) {
  return { window: WINDOW, memberIds: TEAM, hasGlobalMindmapImage: true, preview: p };
}

describe("checkEntry", () => {
  it("passes a complete entry and reports the snapshot it read", async () => {
    const readChain = vi.fn(async () => anchoredChain());
    const check = await checkEntry(input(), { readChain });
    expect(check.allPassed).toBe(true);
    expect(check.chainUnavailable).toBe(false);
    expect(check.rules.every((r) => r.passed === true)).toBe(true);
    expect(check.doqtri).toEqual({ receivedAt: RECEIVED, noteCount: 5 });
    expect(readChain).toHaveBeenCalledWith(expect.objectContaining({ window: WINDOW }));
  });

  it("fails with the gate's own reason", async () => {
    const check = await checkEntry(input(), {
      readChain: async () => ({ ...anchoredChain(), anchoredMilestoneIds: [] }),
    });
    expect(check.allPassed).toBe(false);
    expect(check.rules.find((r) => r.id === "milestones_on_chain")).toEqual({
      id: "milestones_on_chain",
      passed: false,
      reason: "No milestone anchored on chain during the event (project not registered on chain)",
    });
  });

  it("leaves the chain rules unchecked, not failed, when the chain does not answer", async () => {
    const check = await checkEntry(input(), {
      readChain: async () => {
        throw new ChainUnavailableError("timeout");
      },
    });
    expect(check.chainUnavailable).toBe(true);
    expect(check.allPassed).toBe(false);
    for (const id of ["notes_on_chain", "milestones_on_chain"]) {
      expect(check.rules.find((r) => r.id === id)).toEqual({ id, passed: null, reason: CHAIN_UNCHECKED_REASON });
    }
    expect(check.rules.filter((r) => r.passed === false)).toEqual([]);
  });

  it("rethrows anything that is not the chain being unavailable", async () => {
    await expect(
      checkEntry(input(), {
        readChain: async () => {
          throw new Error("bug");
        },
      }),
    ).rejects.toThrow("bug");
  });

  it("reports no snapshot when nothing was pushed", async () => {
    const check = await checkEntry(
      input(preview({ doqtri_snapshot: null, doqtri_received_at: null, doqtri_note_count: null })),
      { readChain: async () => anchoredChain(null) },
    );
    expect(check.doqtri).toBeNull();
    expect(check.rules.find((r) => r.id === "notes_during_event")?.reason).toBe("No doqtri snapshot received");
  });

  it("throws on a preview that is not the RPC's shape", async () => {
    await expect(checkEntry(input({ nope: true }), { readChain: async () => anchoredChain() })).rejects.toThrow();
  });
});
