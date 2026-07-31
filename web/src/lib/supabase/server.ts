import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import type { Database } from '@/lib/types/database'

import { getSupabasePublishableKey, getSupabaseUrl } from './env'

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Must be awaited: `cookies()` is asynchronous in Next.js 16 (synchronous
 * access was removed outright in v16 — see
 * `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`).
 *
 * Create a new client per request. Never hoist one to module scope: the client
 * closes over one request's cookie store, so sharing it leaks sessions between
 * users.
 *
 * ```ts
 * const supabase = await createClient()
 * const { data: { user } } = await supabase.auth.getUser()
 * ```
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // `cookies().set()` throws when called during Server Component
            // render — HTTP forbids Set-Cookie once streaming has started.
            // Swallowing it is safe *because* src/proxy.ts refreshes the
            // session on every matched request and writes the rotated tokens
            // to the response there. If you remove the proxy, users will be
            // silently logged out when their access token expires.
          }
        },
      },
    },
  )
}

/**
 * The authenticated user, or `null`.
 *
 * Prefer this over `auth.getSession()` in server code: `getUser()` revalidates
 * the JWT against the Auth server, whereas the session is read straight from a
 * cookie the client controls and must not be trusted for authorization.
 */
export async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
}
