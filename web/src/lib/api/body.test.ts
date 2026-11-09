import { describe, expect, it } from "vitest";

import {
  docVersionField,
  doqtriUrlField,
  FieldErrors,
  httpsUrlField,
  MAX_BODY_BYTES,
  optionalDateField,
  pathId,
  readJsonBody,
  readJsonObject,
  titleField,
} from "./body";
import { ApiError } from "./errors";

const json = (raw: string, headers: Record<string, string> = {}) =>
  new Request("https://qdit.test/api/v1/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });

async function fieldsOf(promise: Promise<unknown>): Promise<Record<string, string>> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).code).toBe("invalid_request");
  return (error as ApiError).details?.fields as Record<string, string>;
}

describe("readJsonObject", () => {
  it("accepts application/json with parameters, in any case", async () => {
    await expect(readJsonObject(json('{"a":1}', { "content-type": "Application/JSON; charset=utf-8" }))).resolves.toEqual({ a: 1 });
  });

  it("refuses a declared length over 64 KiB before reading the body", async () => {
    const fields = await fieldsOf(readJsonObject(json("{}", { "content-length": String(MAX_BODY_BYTES + 1) })));
    expect(fields).toEqual({ body: "must be at most 64 KiB" });
  });

  it("counts bytes, not characters", async () => {
    // 22,000 three-byte characters: under 64 Ki characters, over 64 KiB.
    const fields = await fieldsOf(readJsonObject(json(JSON.stringify({ t: "€".repeat(22_000) }))));
    expect(fields).toEqual({ body: "must be at most 64 KiB" });
  });

  it.each(["null", "[]", '"text"', "7"])("refuses %s at the top level", async (raw) => {
    expect(await fieldsOf(readJsonObject(json(raw)))).toEqual({ body: "must be a JSON object" });
  });
});

describe("field readers", () => {
  it("collects every problem before throwing", () => {
    const errors = new FieldErrors();
    titleField(errors, "title", "");
    httpsUrlField(errors, "doc_url", "ftp://x");
    errors.rejectUnknown({ title: "", extra: 1 }, ["title"]);

    expect(() => errors.throwIfAny()).toThrow(ApiError);
    expect(errors.fields).toEqual({
      title: "must be 1 to 300 characters after trimming",
      doc_url: "must be an https URL",
      extra: "unknown field",
    });
  });

  it("counts a title the way Postgres does, by code point", () => {
    const errors = new FieldErrors();
    // 300 emoji are 600 UTF-16 units but 300 characters.
    expect(titleField(errors, "title", "🙂".repeat(300))).toBe("🙂".repeat(300));
    expect(titleField(errors, "title", "🙂".repeat(301))).toBeUndefined();
  });

  it("holds a doc_url to doqtri's origin, after the https rules", () => {
    const origin = "https://www.doqtri.xyz";
    const errors = new FieldErrors();
    expect(doqtriUrlField(errors, "a", "https://www.doqtri.xyz/d/1", origin)).toBe("https://www.doqtri.xyz/d/1");
    expect(doqtriUrlField(errors, "b", "https://evil.example/d/1", origin)).toBeUndefined();
    expect(doqtriUrlField(errors, "c", "https://www.doqtri.xyz.evil.example/d/1", origin)).toBeUndefined();
    expect(doqtriUrlField(errors, "d", "http://www.doqtri.xyz/d/1", origin)).toBeUndefined();
    expect(doqtriUrlField(errors, "e", undefined, origin)).toBeUndefined();
    expect(errors.fields).toEqual({
      b: "must be a doqtri URL starting with https://www.doqtri.xyz/",
      c: "must be a doqtri URL starting with https://www.doqtri.xyz/",
      d: "must be an https URL",
      e: "is required",
    });
  });

  it("refuses an https URL with no host, or with leading spaces", () => {
    const errors = new FieldErrors();
    expect(httpsUrlField(errors, "a", "https:///path")).toBeUndefined();
    expect(httpsUrlField(errors, "b", " https://www.doqtri.xyz")).toBeUndefined();
    expect(httpsUrlField(errors, "c", "https://www.doqtri.xyz/d/1?x=1#y")).toBe("https://www.doqtri.xyz/d/1?x=1#y");
  });

  it.each([
    ["2028-02-29", "2028-02-29"],
    ["2026-02-29", undefined],
    ["2026-13-01", undefined],
    ["2026-1-01", undefined],
    [null, null],
  ])("reads due date %j as %j", (value, expected) => {
    expect(optionalDateField(new FieldErrors(), "due_date", value)).toBe(expected);
  });

  it.each([
    [1, 1],
    [4_294_967_295, 4_294_967_295],
    [null, null],
    [undefined, null],
    [-1, undefined],
    [Number.NaN, undefined],
  ])("reads doc_version %j as %j", (value, expected) => {
    expect(docVersionField(new FieldErrors(), "doc_version", value)).toBe(expected);
  });
});

describe("pathId", () => {
  it("lowercases a UUID", () => {
    expect(pathId("3F6C2A1E-8B4D-4C7E-9A10-2D5B7E9F1C34", "x")).toBe("3f6c2a1e-8b4d-4c7e-9a10-2d5b7e9f1c34");
  });

  it("is not_found for anything else, never invalid_request", () => {
    expect(() => pathId("../etc", "No such thing.")).toThrow(
      expect.objectContaining({ code: "not_found", message: "No such thing." }),
    );
  });
});

describe("readJsonObject with a larger limit (D-118)", () => {
  const MiB2 = 2 * 1024 * 1024;

  it("takes a body over 64 KiB when the endpoint allows more", async () => {
    const raw = JSON.stringify({ t: "x".repeat(100_000) });
    await expect(readJsonObject(json(raw), MiB2)).resolves.toEqual({ t: "x".repeat(100_000) });
  });

  it("names the endpoint's limit when the body is over it", async () => {
    const raw = JSON.stringify({ t: "x".repeat(MiB2) });
    expect(await fieldsOf(readJsonObject(json(raw), MiB2))).toEqual({ body: "must be at most 2 MiB" });
    expect(await fieldsOf(readJsonObject(json("{}", { "content-length": String(MiB2 + 1) }), MiB2))).toEqual({
      body: "must be at most 2 MiB",
    });
  });

  it("readJsonBody returns the exact bytes it parsed", async () => {
    const raw = '{ "a" : "€" }';
    const { body, bytes } = await readJsonBody(json(raw));
    expect(body).toEqual({ a: "€" });
    expect(Buffer.from(bytes).toString("utf8")).toBe(raw);
  });
});

describe("readJsonBody streams the body against the limit", () => {
  it("cancels a body with no Content-Length as soon as it passes the limit", async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://qdit.test/api/v1/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: endless,
      duplex: "half",
    } as RequestInit);

    expect(await fieldsOf(readJsonBody(request))).toEqual({ body: "must be at most 64 KiB" });
    expect(cancelled).toBe(true);
    // 64 KiB in 16 KiB chunks: the fifth chunk passes the limit; little more is read.
    expect(pulled).toBeLessThanOrEqual(7);
  });

  it("reads a body sent in many chunks whole", async () => {
    const raw = JSON.stringify({ t: "€".repeat(5_000) });
    const encoded = new TextEncoder().encode(raw);
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < encoded.length; i += 7) controller.enqueue(encoded.slice(i, i + 7));
        controller.close();
      },
    });
    const request = new Request("https://qdit.test/api/v1/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chunked,
      duplex: "half",
    } as RequestInit);

    const { body, bytes } = await readJsonBody(request);
    expect(body).toEqual({ t: "€".repeat(5_000) });
    expect(Buffer.from(bytes).equals(Buffer.from(encoded))).toBe(true);
  });
});

describe("FieldErrors with keys Object.prototype has", () => {
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"])(
    "records and rejects %s as an unknown field",
    async (key) => {
      // Raw JSON: JSON.parse makes even __proto__ an own key.
      const body = (await readJsonObject(json(`{"a":1,"${key}":2}`))) as Record<string, unknown>;
      const errors = new FieldErrors();
      errors.rejectUnknown(body, ["a"], "", { a: "hint" });
      expect(Object.keys(errors.fields)).toEqual([key]);
      expect(errors.fields[key]).toBe("unknown field");
      expect(() => errors.throwIfAny()).toThrow(ApiError);
    },
  );

  it("uses a hint only when one is given for that key", () => {
    const errors = new FieldErrors();
    errors.rejectUnknown({ old: 1, constructor: 2 }, [], "", { old: "renamed to new" });
    expect({ ...errors.fields }).toEqual({ old: "renamed to new", constructor: "unknown field" });
  });
});
