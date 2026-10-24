import type { AuthOAuthServerApi, OAuthAuthorizationDetails } from "@supabase/supabase-js";

/**
 * The logic behind /oauth/consent, kept out of the page so it can be tested.
 *
 * qdit is an OAuth 2.1 provider (masterplan D-02) through Supabase Auth's
 * OAuth server. When doqtri sends a user to authorize, Supabase Auth creates an
 * authorization request and redirects the browser to this app's consent page
 * with `?authorization_id=…`. The page asks Auth what the request is, shows it,
 * and posts the user's decision back; Auth answers both calls with the URL to
 * send the browser to next, carrying either a code or `access_denied`.
 *
 * Uses the `supabase.auth.oauth` API that ships in the installed
 * @supabase/auth-js (2.111): getAuthorizationDetails, approveAuthorization,
 * denyAuthorization. The functions here take that API as an argument rather
 * than building a client, so the tests can hand in a fake.
 */

export type ConsentApi = Pick<
  AuthOAuthServerApi,
  "getAuthorizationDetails" | "approveAuthorization" | "denyAuthorization"
>;

export type ConsentDecision = "approve" | "deny";

export type ScopeLine = { scope: string; label: string };

export type ConsentRequest = {
  authorizationId: string;
  client: {
    id: string;
    name: string;
    /** Host of the client's website, for "who is this", or null if unusable. */
    host: string | null;
  };
  /** Host the browser goes back to — named so a lookalike is visible. */
  redirectHost: string | null;
  scopes: ScopeLine[];
  userEmail: string | null;
};

export type ConsentView =
  | { kind: "consent"; request: ConsentRequest }
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string };

export type DecisionOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string };

/**
 * What a connected app can do in qdit, whatever scopes it was granted.
 *
 * OAuth scopes in Supabase Auth describe identity claims (`openid`, `email`,
 * `profile`), not data access. Data access is decided by Row Level Security,
 * which treats a token carrying a `client_id` claim as an app and allows it
 * only the reads and writes in D-03 — see
 * supabase/migrations/20261024110000_oauth_client_guards.sql. This is the
 * sentence version of that migration, and the consent screen has to say it
 * because the scope list alone would undersell what "Allow" means.
 *
 * It describes the grant those migrations issue today, nothing ahead of it:
 * the read and create rules of that one, and the link writes of
 * 20261024120000_integration_links.sql (WP-2.4) — linking documents and their
 * headings to projects and milestones, and renaming a linked milestone, whose
 * title is then the linking app's (D-12).
 */
export const APP_ACCESS = {
  can: [
    "See the projects you belong to and your role in each",
    "See those projects' milestones and their on-chain proof records",
    "See your own qdit profile",
    "Create milestones, as proposed, in projects where you are a member or above",
    "Link its documents to projects you administer, and link their headings to milestones where you are a member or above",
    "Rename a milestone that is linked to one of its headings — the title only",
  ],
  cannot: [
    "Approve or reject milestones, or delete projects or milestones",
    "Change anything about a milestone except a linked milestone's title",
    "Change members, roles or project settings",
    "See or change tasks, proofs of work, deployments, review notes, your notifications, qdit's log of its requests, its webhook settings and queue, or its record of which connections keep a plan linked",
    "See your teammates' profiles or who else is in your projects",
  ],
} as const;

/**
 * The tables behind the first half of APP_ACCESS, as the guard migration has
 * them. `readable` are left to the user's own read policies; `ownRowOnly` are
 * narrowed to the user's own row; `hidden` answer an app with nothing.
 *
 * Not used at runtime. oauth-consent.test.ts checks it against the migration's
 * restrictive SELECT policies, so a change to what an app can read fails a
 * test until this — and the sentences above — are changed with it. The pgTAP
 * tripwire in supabase/tests/oauth_client_guards.test.sql holds the same list.
 */
export const APP_READ_SCOPE = {
  readable: [
    "milestone_anchors",
    "milestone_external_links",
    "milestones",
    "project_doc_links",
    "projects",
  ],
  ownRowOnly: ["profiles", "project_members"],
  hidden: [
    "api_requests",
    "deployments",
    // Which connections keep a plan linked (20261025120600_doc_link_connections.sql):
    // qdit's bookkeeping about grants, for the doc card, not data D-03 opens.
    "doc_link_connections",
    // The webhook outbox and endpoints (20261024130000_integration_webhooks.sql):
    // qdit's own delivery state, closed to every client role, not user data.
    "integration_events",
    "integration_webhooks",
    "milestone_reviews",
    "notifications",
    "stellar_proofs",
    "tasks",
  ],
} as const;

const SCOPE_LABEL: Record<string, string> = {
  openid: "Confirm who you are on qdit",
  email: "See your email address",
  profile: "See your name and avatar",
  phone: "See your phone number",
};

/**
 * Authorization ids are opaque tokens from Supabase Auth. The SDK splices this
 * value into a request path (`/oauth/authorizations/<id>`), so it is held to
 * URL-safe characters with no dots — a `../` here would point a request made
 * with the user's session somewhere else on the Auth server.
 */
export function parseAuthorizationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[A-Za-z0-9_-]{1,256}$/.test(id) ? id : null;
}

/** Where this page lives for a given request — the `next` that login carries. */
export function consentPath(authorizationId: string): string {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

/** Space-separated scopes, de-duplicated, in a sentence each. */
export function describeScopes(scope: string | null | undefined): ScopeLine[] {
  const seen = new Set<string>();
  const lines: ScopeLine[] = [];

  for (const raw of (scope ?? "").split(/\s+/)) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    lines.push({ scope: raw, label: SCOPE_LABEL[raw] ?? raw });
  }

  return lines;
}

/**
 * Accepts the redirect Auth hands back only when it is a real web URL.
 *
 * Auth validated it against the client's registered redirect URIs already;
 * this is the second look a `redirect()` to another origin deserves before the
 * browser is sent there with an authorization code in the query. `http` is
 * allowed only for a loopback host, for local development.
 */
export function safeClientRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol === "https:") return url.toString();
  if (url.protocol === "http:" && isLoopback(url.hostname)) return url.toString();
  return null;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : null;
  } catch {
    return null;
  }
}

/** Shown for any Auth failure. The real error is logged, not rendered. */
export const EXPIRED_MESSAGE =
  "This sign-in request has expired or was already used. Go back to the app " +
  "and connect again.";

function isDetails(data: unknown): data is OAuthAuthorizationDetails {
  return typeof data === "object" && data !== null && "authorization_id" in data;
}

/**
 * Asks Auth what this authorization request is.
 *
 * Three answers: show a consent screen; the user already approved this client
 * for these scopes, so go straight back (Auth returns a redirect for that); or
 * the request is unknown, expired or not this user's.
 */
export async function loadConsent(api: ConsentApi, authorizationId: string): Promise<ConsentView> {
  const { data, error } = await api.getAuthorizationDetails(authorizationId);

  if (error || !data) {
    console.error("oauth consent: getAuthorizationDetails failed", error);
    return { kind: "error", message: EXPIRED_MESSAGE };
  }

  if (!isDetails(data)) {
    const url = safeClientRedirect(data.redirect_url);
    if (!url) {
      console.error("oauth consent: unusable redirect_url from Auth");
      return { kind: "error", message: EXPIRED_MESSAGE };
    }
    return { kind: "redirect", url };
  }

  return {
    kind: "consent",
    request: {
      authorizationId: data.authorization_id,
      client: {
        id: data.client.id,
        name: data.client.name?.trim() || "An app",
        host: hostOf(data.client.uri),
      },
      redirectHost: hostOf(data.redirect_uri),
      scopes: describeScopes(data.scope),
      userEmail: data.user?.email ?? null,
    },
  };
}

/** Posts the decision and returns where the browser goes next. */
export async function decideConsent(
  api: ConsentApi,
  authorizationId: string,
  decision: ConsentDecision,
): Promise<DecisionOutcome> {
  // Never let the SDK navigate on its own. On the server it cannot, but this
  // runs from a Server Action and the redirect is that action's to make.
  const options = { skipBrowserRedirect: true };

  const { data, error } =
    decision === "approve"
      ? await api.approveAuthorization(authorizationId, options)
      : await api.denyAuthorization(authorizationId, options);

  if (error || !data) {
    console.error(`oauth consent: ${decision} failed`, error);
    return { kind: "error", message: EXPIRED_MESSAGE };
  }

  const url = safeClientRedirect(data.redirect_url);
  if (!url) {
    console.error("oauth consent: unusable redirect_url from Auth");
    return { kind: "error", message: EXPIRED_MESSAGE };
  }

  return { kind: "redirect", url };
}

/** Parses the decision a consent form posted. Anything else is no decision. */
export function parseDecision(value: unknown): ConsentDecision | null {
  return value === "approve" || value === "deny" ? value : null;
}
