import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Where Supabase sends the user back after an email confirmation, magic link
 * or OAuth redirect. Exchanges the one-time `code` for a session cookie.
 *
 * The redirect target is deliberately restricted to a path on this origin: an
 * open `next` parameter is a redirect vulnerability, letting a crafted
 * confirmation link bounce a freshly authenticated user to an attacker's page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
