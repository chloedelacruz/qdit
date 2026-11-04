/**
 * Service-role PostgREST calls against either app's Supabase project, for the
 * setup, read-back and cleanup a spec cannot do through the apps themselves.
 *
 * Only setup and assertions on stored state go through here. Every behaviour
 * under test goes through the apps: their pages, their API routes, qdit's
 * /api/v1 and its OAuth server.
 */
import { env } from "./env";

type Side = "qdit" | "doqtri";

function target(side: Side): { url: string; key: string } {
  const e = env();
  return side === "qdit"
    ? { url: e.qditSupabaseUrl, key: e.qditSecretKey }
    : { url: e.doqtriSupabaseUrl, key: e.doqtriServiceKey };
}

export async function serviceRest<T = unknown>(
  side: Side,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  const { url, key } = target(side);
  const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: init.prefer ?? "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  // Never echo the key; the path and body are the suite's own.
  if (!res.ok) throw new Error(`${side} ${init.method ?? "GET"} ${path}: ${res.status} ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** A PostgREST call as an end user's token, on qdit's project. */
export async function qditRestAs(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const e = env();
  return fetch(`${e.qditSupabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: e.qditPublishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** Unique per run, and greppable by the cleanup. */
export function tag(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Every title and slug the suite writes starts with this, so cleanup can find leftovers. */
export const NAME_PREFIX = "DQIT";
export const SLUG_PREFIX = "dqit-";
