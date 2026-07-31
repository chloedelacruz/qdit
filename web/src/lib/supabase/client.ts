import { createBrowserClient } from '@supabase/ssr'

import type { Database } from '@/lib/types/database'

import { getSupabasePublishableKey, getSupabaseUrl } from './env'

/**
 * Supabase client for Client Components.
 *
 * `createBrowserClient` is a singleton by default, so calling this on every
 * render is cheap — you get the same underlying client back and the auth
 * listener is not re-registered.
 *
 * No `cookies` option is passed on purpose: in a browser runtime the library
 * falls back to `document.cookie`, which is exactly the store `proxy.ts` and
 * the server client read from. Overriding it here is how sessions drift.
 *
 * ```ts
 * 'use client'
 * const supabase = createClient()
 * const { data } = await supabase.from('tasks').select('*')
 * ```
 */
export function createClient() {
  return createBrowserClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
  )
}
