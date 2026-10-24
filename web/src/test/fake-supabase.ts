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
