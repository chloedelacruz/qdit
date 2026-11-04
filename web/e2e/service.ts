/**
 * Service-role access to the database under test, for the specs that need a
 * fixture `seed.sql` does not hold.
 *
 * Node only: the secret key never reaches a browser. The same two variables as
 * `reseed.setup.ts` and `cleanup.teardown.ts`, read the same way.
 *
 * Unlike those two, a spec that builds its own fixture cannot carry on without
 * one, so a missing key is a `null` the caller turns into a skip with a reason,
 * never a silent pass.
 */
export type Service = {
  url: string;
  headers: Record<string, string>;
};

export function service(): Service | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;

  return {
    url,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  };
}

export const NO_SERVICE =
  "SUPABASE_SECRET_KEY is not set, so this spec cannot build or clean up its fixture.";

/**
 * PostgREST, with the status and body folded into the error.
 *
 * The body matters: a check constraint or trigger names itself in it, and that
 * is the line someone needs when a fixture insert starts failing.
 */
export async function rest<T>(
  svc: Service,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  const response = await fetch(`${svc.url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: init.prefer ? { ...svc.headers, Prefer: init.prefer } : svc.headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

/** A short random tag, so parallel or crashed runs never collide on a name. */
export function tag(): string {
  return Math.random().toString(36).slice(2, 10);
}
