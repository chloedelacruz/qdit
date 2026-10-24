import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import {
  DEFAULT_LIMIT,
  afterCursorFilter,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from "./pagination";

const ID = "3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34";

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof ApiError ? error.code : "not-an-api-error";
  }
}

describe("parseLimit", () => {
  it("defaults when absent and accepts 1 to 100", () => {
    expect(parseLimit(null)).toBe(DEFAULT_LIMIT);
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("100")).toBe(100);
  });

  it.each(["", "0", "101", "-1", "1.5", "1e2", " 5", "abc"])(
    "rejects %j",
    (raw) => {
      expect(code(() => parseLimit(raw))).toBe("invalid_request");
    },
  );
});

describe("cursor", () => {
  it("round-trips created_at exactly, microseconds included", () => {
    const cursor = { createdAt: "2026-10-01T09:30:00.123456+00:00", id: ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("is null for the first page", () => {
    expect(decodeCursor(null)).toBeNull();
  });

  it.each([
    ["not base64url", "abc$"],
    ["not JSON", Buffer.from("nope").toString("base64url")],
    ["JSON null", Buffer.from("null").toString("base64url")],
    ["a bad timestamp", Buffer.from(JSON.stringify({ c: "2026-10-01", i: ID })).toString("base64url")],
    ["an uppercase id", Buffer.from(JSON.stringify({ c: "2026-10-01T09:30:00Z", i: ID.toUpperCase() })).toString("base64url")],
    [
      "filter syntax smuggled into the timestamp",
      Buffer.from(JSON.stringify({ c: '2026-10-01T09:30:00Z",id.gt.0', i: ID })).toString("base64url"),
    ],
    ["an impossible date", Buffer.from(JSON.stringify({ c: "2026-13-45T09:30:00Z", i: ID })).toString("base64url")],
  ])("rejects %s as invalid_request", (_label, raw) => {
    expect(code(() => decodeCursor(raw))).toBe("invalid_request");
  });

  it("builds a created_at desc, id desc keyset filter", () => {
    expect(afterCursorFilter({ createdAt: "2026-10-01T09:30:00Z", id: ID })).toBe(
      `created_at.lt."2026-10-01T09:30:00Z",and(created_at.eq."2026-10-01T09:30:00Z",id.lt.${ID})`,
    );
  });
});
