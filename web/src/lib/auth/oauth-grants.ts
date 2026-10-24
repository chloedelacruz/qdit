import type { OAuthGrant } from "@supabase/supabase-js";

import { describeScopes, type ScopeLine } from "./oauth-consent";

/**
 * An app the signed-in user has connected through qdit's OAuth server, as the
 * Settings page lists it.
 *
 * From `supabase.auth.oauth.listGrants()` in the installed auth-js. (The WP
 * brief called these getUserGrants / revokeGrant; the SDK names them listGrants
 * / revokeGrant.)
 */
export type AuthorizedApp = {
  clientId: string;
  name: string;
  host: string | null;
  scopes: ScopeLine[];
  grantedAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** OAuth client ids are UUIDs; anything else posted to revoke is not one. */
export function parseClientId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

/** Newest first, so an app connected a minute ago is at the top. */
export function toAuthorizedApps(grants: readonly OAuthGrant[] | null | undefined): AuthorizedApp[] {
  return (grants ?? [])
    .map((grant) => ({
      clientId: grant.client.id,
      name: grant.client.name?.trim() || "Unnamed app",
      host: hostOf(grant.client.uri),
      scopes: describeScopes((grant.scopes ?? []).join(" ")),
      grantedAt: grant.granted_at,
    }))
    .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
}
