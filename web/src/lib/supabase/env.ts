/**
 * Reads and validates the Supabase environment variables shared by every
 * client factory in this directory.
 *
 * Only `NEXT_PUBLIC_*` values live here — they are safe to inline into the
 * browser bundle. Never import a service-role key from this module.
 */

/**
 * Publishable key env var.
 *
 * Supabase renamed the legacy `anon` JWT to a "publishable key"
 * (`sb_publishable_...`). New projects issue the latter; older ones still hand
 * out the former. Both are read here so either naming works, with the modern
 * name taking precedence.
 */
function readPublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        `Copy web/.env.example to web/.env.local and fill it in.`,
    )
  }
  return value
}

/** Project URL, e.g. `https://<ref>.supabase.co` or `http://127.0.0.1:54321`. */
export function getSupabaseUrl(): string {
  return required(
    'NEXT_PUBLIC_SUPABASE_URL',
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  )
}

/** Publishable (a.k.a. anon) key. Safe to expose to the browser; RLS guards the data. */
export function getSupabasePublishableKey(): string {
  return required(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    readPublishableKey(),
  )
}
