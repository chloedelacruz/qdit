import type { NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/proxy'

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`: the file must
 * be `src/proxy.ts` and export a function named `proxy` (or a default export).
 * `middleware.ts` / `export function middleware` are deprecated.
 * See `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.
 *
 * The runtime is Node.js and is not configurable here — setting the `runtime`
 * segment config in a proxy file throws.
 *
 * Its only job is refreshing the Supabase session so Server Components (which
 * cannot write cookies during render) always see a valid token.
 *
 * This is deliberately *not* an authorization gate. Per the Next.js docs, a
 * matcher change can silently drop proxy coverage for a route, and Server
 * Functions are handled as POSTs to the route that uses them — so every page,
 * Route Handler and Server Action must still check the user itself. RLS in
 * `supabase/migrations/20260731000002_rls.sql` is the real boundary.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Run on everything except:
     * - _next/static  (build output)
     * - _next/image   (image optimizer)
     * - favicon.ico, sitemap.xml, robots.txt
     * - common static asset extensions served from public/
     *
     * API routes are intentionally *included*: Route Handlers need a refreshed
     * session just as much as pages do.
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf)$).*)',
  ],
}
