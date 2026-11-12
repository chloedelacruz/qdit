import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  eventBody,
  formatOccurredAt,
  signatureHeader,
  webhookSignature,
  webhookTimestamp,
  HACKATHON_RELEASED_EVENT,
  WEBHOOK_EVENT,
} from "./signing";

/**
 * docs/integration/CONTRACT.md section 9, worked example. Every literal
 * below is copied from the contract; if one of these fails, either this
 * module or the contract is wrong, and doqtri verifies against the contract.
 */
const CONTRACT_SECRET = "whsec_example_do_not_use";
const CONTRACT_TIMESTAMP = "1792843200";
const CONTRACT_BODY =
  '{"id":"7d0f8a52-3c1e-4b6a-9f21-5e8c0d4b2a10","event":"milestone.status_changed","project_id":"3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34","milestone_id":"b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61","status":"approved","occurred_at":"2026-10-24T11:59:58.412Z"}';
const CONTRACT_SIGNATURE = "2af3710d7ffbe0732e23e5d7e81b6e3350569bb189fd133681af78a2826e1bfe";

/** The outbox row the example body comes from, as PostgREST returns it. */
const ROW = {
  id: "7d0f8a52-3c1e-4b6a-9f21-5e8c0d4b2a10",
  event: WEBHOOK_EVENT,
  project_id: "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34",
  milestone_id: "b81e4f07-6a2c-4d93-8e5f-0c7a9b3d2e61",
  status: "approved" as const,
  occurred_at: "2026-10-24T11:59:58.412+00:00",
};

describe("the contract's worked example", () => {
  it("builds the 247-byte body byte for byte", () => {
    const body = eventBody(ROW);
    expect(body).toBe(CONTRACT_BODY);
    expect(Buffer.byteLength(body, "utf8")).toBe(247);
  });

  it("uses 1792843200 for 2026-10-24T12:00:00Z", () => {
    expect(webhookTimestamp(new Date("2026-10-24T12:00:00Z"))).toBe(CONTRACT_TIMESTAMP);
    expect(webhookTimestamp(new Date("2026-10-24T12:00:00.999Z"))).toBe(CONTRACT_TIMESTAMP);
  });

  it("signs it to the contract's signature", () => {
    expect(webhookSignature(CONTRACT_SECRET, CONTRACT_TIMESTAMP, CONTRACT_BODY)).toBe(CONTRACT_SIGNATURE);
    expect(signatureHeader([CONTRACT_SECRET], CONTRACT_TIMESTAMP, eventBody(ROW))).toBe(
      `sha256=${CONTRACT_SIGNATURE}`,
    );
  });

  it("is the HMAC of `<timestamp>.<raw body>` (the openssl recipe)", () => {
    const expected = createHmac("sha256", CONTRACT_SECRET)
      .update(`${CONTRACT_TIMESTAMP}.${CONTRACT_BODY}`)
      .digest("hex");
    expect(webhookSignature(CONTRACT_SECRET, CONTRACT_TIMESTAMP, CONTRACT_BODY)).toBe(expected);
  });
});

/** The same section's `hackathon.released` example (contract v1.5.0, QDIT-67). */
const RELEASED_TIMESTAMP = "1795339805";
const RELEASED_BODY =
  '{"id":"5c1e9a7b-2d4f-4e8a-b6c3-9f0d1a2b3c4e","event":"hackathon.released","hackathon_slug":"stellar-build-2026","released_at":"2026-11-22T09:30:00.000Z","occurred_at":"2026-11-22T09:30:00.000Z"}';
const RELEASED_SIGNATURE = "e9a1a9f192815ca44ae84f20bc7a66576142473510eb372846b6aa64222bfbfb";
const RELEASED_ROW = {
  id: "5c1e9a7b-2d4f-4e8a-b6c3-9f0d1a2b3c4e",
  event: HACKATHON_RELEASED_EVENT,
  project_id: null,
  milestone_id: null,
  status: null,
  hackathon_slug: "stellar-build-2026",
  released_at: "2026-11-22T17:30:00+08:00",
  occurred_at: "2026-11-22T09:30:00+00:00",
};

describe("the contract's hackathon.released example", () => {
  it("builds the 194-byte body byte for byte, in the contract's key order", () => {
    const body = eventBody(RELEASED_ROW);
    expect(body).toBe(RELEASED_BODY);
    expect(Buffer.byteLength(body, "utf8")).toBe(194);
    expect(Object.keys(JSON.parse(body))).toEqual(["id", "event", "hackathon_slug", "released_at", "occurred_at"]);
  });

  it("uses 1795339805 for 2026-11-22T09:30:05Z and signs it to the contract's signature", () => {
    expect(webhookTimestamp(new Date("2026-11-22T09:30:05Z"))).toBe(RELEASED_TIMESTAMP);
    expect(webhookSignature(CONTRACT_SECRET, RELEASED_TIMESTAMP, RELEASED_BODY)).toBe(RELEASED_SIGNATURE);
    expect(signatureHeader([CONTRACT_SECRET], RELEASED_TIMESTAMP, eventBody(RELEASED_ROW))).toBe(
      `sha256=${RELEASED_SIGNATURE}`,
    );
  });

  it("refuses a release row without its slug or time, and an unknown type", () => {
    expect(() => eventBody({ ...RELEASED_ROW, hackathon_slug: null })).toThrow(/without its hackathon/);
    expect(() => eventBody({ ...RELEASED_ROW, released_at: null })).toThrow(/without its hackathon/);
    expect(() => eventBody({ ...RELEASED_ROW, released_at: "soon" })).toThrow(/released_at/);
    expect(() => eventBody({ ...RELEASED_ROW, event: "hackathon.closed" })).toThrow(/unknown type/);
  });

  it("refuses a milestone row without its milestone", () => {
    expect(() => eventBody({ ...ROW, milestone_id: null })).toThrow(/without its milestone/);
  });
});

describe("body", () => {
  it("carries ids and a status only, in the contract's key order", () => {
    expect(Object.keys(JSON.parse(eventBody(ROW)))).toEqual([
      "id",
      "event",
      "project_id",
      "milestone_id",
      "status",
      "occurred_at",
    ]);
  });

  it("is the same bytes every time for the same row (retries resend it)", () => {
    expect(eventBody(ROW)).toBe(eventBody({ ...ROW }));
  });

  it("normalises any offset to UTC with milliseconds and Z", () => {
    expect(formatOccurredAt("2026-10-24T13:59:58.412+02:00")).toBe("2026-10-24T11:59:58.412Z");
    expect(formatOccurredAt("2026-10-24T11:59:58+00:00")).toBe("2026-10-24T11:59:58.000Z");
  });

  it("refuses a value that is not a timestamp", () => {
    expect(() => formatOccurredAt("yesterday")).toThrow(/occurred_at/);
  });
});

describe("signature header", () => {
  it("sends one signature per secret during rotation, current first", () => {
    const header = signatureHeader(["old-secret", "new-secret"], CONTRACT_TIMESTAMP, CONTRACT_BODY);
    expect(header).toBe(
      `sha256=${webhookSignature("old-secret", CONTRACT_TIMESTAMP, CONTRACT_BODY)},` +
        `sha256=${webhookSignature("new-secret", CONTRACT_TIMESTAMP, CONTRACT_BODY)}`,
    );
  });

  it("depends on the timestamp, so a retry's fresh timestamp gives a fresh signature", () => {
    expect(webhookSignature(CONTRACT_SECRET, "1792843260", CONTRACT_BODY)).not.toBe(CONTRACT_SIGNATURE);
  });

  it("refuses to sign with no secret", () => {
    expect(() => signatureHeader([], CONTRACT_TIMESTAMP, CONTRACT_BODY)).toThrow(/no signing secret/);
  });
});
