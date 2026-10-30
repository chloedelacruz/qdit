/**
 * A stand-in for a Supabase query builder, for route tests.
 *
 * Every builder method (`select`, `eq`, `order`, `or`, `maybeSingle`, ...)
 * records its arguments and returns the same builder; awaiting it resolves to
 * the canned `{ data, error }`. That is enough to assert both what a route
 * asked PostgREST for and what it did with the answer, without a database.
 */
export type RecordedCall = [method: string, ...args: unknown[]];

export function fakeQuery(result: { data: unknown; error: unknown }) {
  const calls: RecordedCall[] = [];

  const builder: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push([String(prop), ...args]);
          return builder;
        };
      },
    },
  );

  return { builder, calls };
}

/** A client whose `from(table)` returns `builder` and records `table`. */
export function fakeClient(builder: object) {
  const tables: string[] = [];
  return {
    tables,
    client: {
      from(table: string) {
        tables.push(table);
        return builder;
      },
    },
  };
}

type Result = { data: unknown; error: unknown; count?: number | null };

export type ScriptedRequest = {
  kind: "from" | "rpc";
  /** Table or function name. */
  name: string;
  /** The `rpc()` arguments; undefined for `from()`. */
  args?: unknown;
  calls: RecordedCall[];
};

/**
 * A client for routes that make several requests. Each `from(table)` and
 * `rpc(fn)` takes the next canned result queued under that name, in order,
 * and every request is logged with its builder calls. A request nothing was
 * queued for throws, which the route wrapper turns into a 500 — so a test
 * that did not expect a write fails on the status it checks.
 */
export function fakeDatabase(script: {
  from?: Record<string, Result[]>;
  rpc?: Record<string, Result[]>;
}) {
  const requests: ScriptedRequest[] = [];
  const queues = {
    from: Object.fromEntries(Object.entries(script.from ?? {}).map(([k, v]) => [k, [...v]])),
    rpc: Object.fromEntries(Object.entries(script.rpc ?? {}).map(([k, v]) => [k, [...v]])),
  };

  function take(kind: "from" | "rpc", name: string, args?: unknown) {
    const next = queues[kind][name]?.shift();
    if (!next) throw new Error(`fakeDatabase: unexpected ${kind}(${name})`);
    const query = fakeQuery(next);
    requests.push({ kind, name, args, calls: query.calls });
    return query.builder;
  }

  return {
    requests,
    /** What is still queued, so a test can assert every request was made. */
    remaining: () =>
      [...Object.entries(queues.from), ...Object.entries(queues.rpc)]
        .filter(([, list]) => list.length > 0)
        .map(([name]) => name),
    client: {
      from: (table: string) => take("from", table),
      rpc: (fn: string, args?: unknown) => take("rpc", fn, args),
    },
  };
}
