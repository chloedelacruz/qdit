import { describe, expect, it } from "vitest";

import {
  docVersionField,
  FieldErrors,
  httpsUrlField,
  MAX_BODY_BYTES,
  optionalDateField,
  pathId,
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
