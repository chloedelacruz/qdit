import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import type { Database } from '@/lib/types/database'

import { getSupabasePublishableKey, getSupabaseUrl } from './env'

/**
 * Session-refresh helper for `src/proxy.ts`.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`
 * (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`),
 * so this module is named to match its only caller. It is the piece that keeps
 * Server Components able to read a valid session: they cannot write cookies
 * during render, so the rotated access/refresh tokens have to be written here.
 *
 * Two rules make this work, and both are easy to break:
 *
 *  1. `supabase.auth.getUser()` must be awaited before the response is
 *     returned. It is what triggers the refresh; skip it and tokens simply
 *     never rotate.
 *  2. The returned `NextResponse` must be the one `setAll` wrote to. If you
 *     construct a fresh `NextResponse` afterwards you drop the `Set-Cookie`
 *     headers and the user is logged out on the next request.
 */
export async function updateSession(request: NextRequest) {
  // Seed the response with the incoming request so cookies survive if nothing
  // needs refreshing.
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          // Mirror onto the request so anything downstream in this same pass
          // sees the refreshed token, not the stale one.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }

          response = NextResponse.next({ request })

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }

          // Supabase supplies `Cache-Control: private, no-store` style headers
          // alongside auth cookies. Without them a CDN or reverse proxy can
          // cache this response and serve one user's session to another.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value)
          }
        },
      },
    },
  )

  // Revalidates the JWT with the Auth server and performs the refresh. Do not
  // replace this with `getSession()`, which trusts the cookie as-is.
  await supabase.auth.getUser()

  return response
}
