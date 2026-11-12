import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cacheLifetimeMs,
  checkMindmapLinks,
  MAX_TOKENS_PER_REQUEST,
  STATUS_CACHE_MS,
  STATUS_TIMEOUT_MS,
  statusOf,
  type StatusCache,
} from "./mindmap-link-status";

/**
 * The mindmap link status client (QDIT-67, contract v1.5.0 section 8):
 * live, dead and unknown answers, one batched request, the 2 s budget, and
 * the 60 s cache.
 */
const ORIGIN = "https://www.doqtri.xyz";
const token = (n: number) => `Tok${n.toString().padStart(4, "0")}_abcdefghijklmnop`;
const link = (n: number) => `${ORIGIN}/m/${token(n)}`;

type Answer = Record<string, { live: unknown; expires_at: string | null }>;

function doqtri(answer: (tokens: string[]) => Answer | Response, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const { tokens } = JSON.parse(String(init?.body)) as { tokens: string[] };
    const result = answer(tokens);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify({ links: result }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "private, max-age=60", ...headers },
    });
  });
}

function setup(fetchFake: ReturnType<typeof vi.fn>, start = 1_000_000) {
  let time = start;
  const cache: StatusCache = new Map();
  return {
    cache,
    advance: (ms: number) => {
      time += ms;
    },
    check: (urls: (string | null | undefined)[]) =>
      checkMindmapLinks(urls, { fetch: fetchFake as unknown as typeof fetch, now: () => time, origin: ORIGIN, cache }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkMindmapLinks: answers", () => {
  it("asks doqtri once, by token, and maps live and dead back to each link", async () => {
    const fetchFake = doqtri(() => ({
      [token(1)]: { live: true, expires_at: "2026-11-23T09:30:00.000Z" },
      [token(2)]: { live: false, expires_at: null },
    }));
    const t = setup(fetchFake);

    const statuses = await t.check([link(1), link(2), null, link(1)]);

    expect(statusOf(statuses, link(1))).toBe("live");
    expect(statusOf(statuses, link(2))).toBe("dead");
    expect(fetchFake).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFake.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/api/mindmap-links/status`);
    expect(init).toMatchObject({ method: "POST", redirect: "manual", cache: "no-store" });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json; charset=utf-8");
    // Each token once, nothing but the tokens, no Authorization.
    expect(JSON.parse(String(init?.body))).toEqual({ tokens: [token(1), token(2)] });
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("sends nothing for no link, or for links that are not DOQTRI_ORIGIN/m/<token>", async () => {
    const fetchFake = doqtri(() => ({}));
    const t = setup(fetchFake);

    const statuses = await t.check([
      null,
      undefined,
      "",
      "https://evil.example/m/Tok0001_abcdefghijklmnop",
      `${ORIGIN}/m/short`,
      `${ORIGIN}/m/${token(1)}?x=1`,
    ]);

    expect(fetchFake).not.toHaveBeenCalled();
    expect(statuses.size).toBe(0);
    expect(statusOf(statuses, "https://evil.example/m/Tok0001_abcdefghijklmnop")).toBe("unknown");
  });

  it("is unknown for a token doqtri left out, or whose live is not a boolean", async () => {
    const t = setup(doqtri(() => ({ [token(2)]: { live: "yes", expires_at: null } })));
    const statuses = await t.check([link(1), link(2)]);
    expect(statusOf(statuses, link(1))).toBe("unknown");
    expect(statusOf(statuses, link(2))).toBe("unknown");
  });

  it.each([
    ["a 404 (a doqtri older than v1.5.0)", () => new Response("Not found", { status: 404 })],
    ["a 429", () => new Response(null, { status: 429, headers: { "retry-after": "30" } })],
    ["a 500", () => new Response(null, { status: 500 })],
    ["a redirect", () => new Response(null, { status: 307, headers: { location: "https://elsewhere.example/" } })],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["a body without links", () => new Response(JSON.stringify({ data: {} }), { status: 200 })],
  ])("is unknown for every link on %s", async (_name, answer) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup(doqtri(answer));
    const statuses = await t.check([link(1), link(2)]);
    expect([statusOf(statuses, link(1)), statusOf(statuses, link(2))]).toEqual(["unknown", "unknown"]);
  });

  it("is unknown on a network error, and never throws or logs a token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFake = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const t = setup(fetchFake);
    const statuses = await t.check([link(1)]);
    expect(statusOf(statuses, link(1))).toBe("unknown");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token(1));
  });

  it("gives up after the timeout: unknown, without waiting for doqtri", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Answers only when aborted, like a doqtri that never responds.
    const fetchFake = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const started = Date.now();
    const statuses = await checkMindmapLinks([link(1)], {
      fetch: fetchFake as unknown as typeof fetch,
      origin: ORIGIN,
      cache: new Map(),
      timeoutMs: 50,
    });
    expect(statusOf(statuses, link(1))).toBe("unknown");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(STATUS_TIMEOUT_MS).toBe(2_000);
  });

  it("asks nothing and answers unknown when DOQTRI_ORIGIN is misconfigured", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFake = doqtri(() => ({}));
    const statuses = await checkMindmapLinks([link(1)], {
      fetch: fetchFake as unknown as typeof fetch,
      origin: "https://www.doqtri.xyz/path",
      cache: new Map(),
    });
    expect(statusOf(statuses, link(1))).toBe("unknown");
    expect(fetchFake).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

describe("checkMindmapLinks: batching", () => {
  it("covers a whole export in one request up to 500 tokens, then splits in parallel", async () => {
    const fetchFake = doqtri((tokens) => Object.fromEntries(tokens.map((t) => [t, { live: true, expires_at: null }])));
    const t = setup(fetchFake);

    const fiveHundred = Array.from({ length: MAX_TOKENS_PER_REQUEST }, (_, i) => link(i));
    await t.check(fiveHundred);
    expect(fetchFake).toHaveBeenCalledTimes(1);

    const more = Array.from({ length: 1_001 }, (_, i) => link(1_000 + i));
    const statuses = await t.check(more);
    expect(fetchFake).toHaveBeenCalledTimes(4);
    const sizes = fetchFake.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)).tokens.length);
    expect(sizes).toEqual([500, 500, 1]);
    expect(more.every((url) => statusOf(statuses, url) === "live")).toBe(true);
  });
});

describe("checkMindmapLinks: cache", () => {
  it("reuses an answer for up to 60 s, then asks again", async () => {
    const fetchFake = doqtri(() => ({ [token(1)]: { live: true, expires_at: null } }));
    const t = setup(fetchFake);

    await t.check([link(1)]);
    t.advance(STATUS_CACHE_MS - 1);
    expect(statusOf(await t.check([link(1)]), link(1))).toBe("live");
    expect(fetchFake).toHaveBeenCalledTimes(1);

    t.advance(1);
    await t.check([link(1)]);
    expect(fetchFake).toHaveBeenCalledTimes(2);
  });

  it("asks only for the tokens it holds no fresh answer for", async () => {
    const fetchFake = doqtri((tokens) => Object.fromEntries(tokens.map((t) => [t, { live: false, expires_at: null }])));
    const t = setup(fetchFake);
    await t.check([link(1)]);
    const statuses = await t.check([link(1), link(2)]);
    expect(JSON.parse(String(fetchFake.mock.calls[1][1]?.body))).toEqual({ tokens: [token(2)] });
    expect(statusOf(statuses, link(1))).toBe("dead");
    expect(statusOf(statuses, link(2))).toBe("dead");
  });

  it("keeps an answer no longer than a smaller max-age, and not at all on no-store", async () => {
    const short = doqtri(() => ({ [token(1)]: { live: true, expires_at: null } }), { "cache-control": "max-age=5" });
    const a = setup(short);
    await a.check([link(1)]);
    a.advance(5_000);
    await a.check([link(1)]);
    expect(short).toHaveBeenCalledTimes(2);

    const none = doqtri(() => ({ [token(1)]: { live: true, expires_at: null } }), { "cache-control": "no-store" });
    const b = setup(none);
    await b.check([link(1)]);
    await b.check([link(1)]);
    expect(none).toHaveBeenCalledTimes(2);
  });

  it("never keeps an unknown status", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFake = doqtri(() => new Response(null, { status: 503 }));
    const t = setup(fetchFake);
    await t.check([link(1)]);
    await t.check([link(1)]);
    expect(fetchFake).toHaveBeenCalledTimes(2);
    expect(t.cache.size).toBe(0);
  });

  it("reads Cache-Control as the contract says", () => {
    expect(cacheLifetimeMs(null)).toBe(60_000);
    expect(cacheLifetimeMs("private, max-age=60")).toBe(60_000);
    expect(cacheLifetimeMs("max-age=600")).toBe(60_000);
    expect(cacheLifetimeMs("public, max-age=10")).toBe(10_000);
    expect(cacheLifetimeMs("max-age=0")).toBe(0);
    expect(cacheLifetimeMs("no-store")).toBe(0);
    expect(cacheLifetimeMs("private, no-cache")).toBe(0);
    expect(cacheLifetimeMs("max-age=soon")).toBe(60_000);
  });
});
