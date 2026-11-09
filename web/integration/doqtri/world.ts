/**
 * Shared setup for the specs: a qdit project, a doqtri note, the OAuth
 * round trip in both of its forms, and cleanup.
 */
import { createHash, randomBytes } from "node:crypto";
import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";

import { storagePaths } from "../../e2e/hackathon-fixture";
import { callbackOf, env, issuerOf } from "./env";
import { NAME_PREFIX, SLUG_PREFIX, serviceRest, tag } from "./rest";

/** A plan with two headings. doqtri numbers headings in order: "# Title" is h0. */
export const PLAN = (title: string) => `# ${title}\n\n## Build the escrow\n\nDetails.\n\n## Ship it\n\nLater.\n`;
export const H_BUILD = { nodeId: "h1", nodeLabel: "Build the escrow" };
export const H_SHIP = { nodeId: "h2", nodeLabel: "Ship it" };

/* -------------------------------------------------------------------------- */
/* qdit project                                                               */
/* -------------------------------------------------------------------------- */

export type QditProject = { id: string; slug: string; name: string };

/**
 * A qdit project owned by `ownerId`. Inserted as the service role because
 * creating a project is not what this suite tests; qdit's on_project_created
 * trigger makes the owner's membership row, as it does for the app's form.
 * Public proofs are on so the public page renders (contract section 12).
 */
export async function createQditProject(ownerId: string): Promise<QditProject> {
  const name = tag(`${NAME_PREFIX} Payroll`);
  const slug = `${SLUG_PREFIX}${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
  const [row] = await serviceRest<{ id: string }[]>("qdit", "projects", {
    method: "POST",
    body: { owner_id: ownerId, name, slug, public_proofs: true },
  });
  return { id: row.id, slug, name };
}

/* -------------------------------------------------------------------------- */
/* doqtri note                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A note in the user's personal workspace, inserted straight into doqtri's
 * database. doqtri's own e2e suite seeds notes the same way: the ingest path
 * calls a model and is not what this suite tests.
 */
export async function seedNote(userId: string, workspaceId: string): Promise<{ id: string; title: string }> {
  const title = tag(`${NAME_PREFIX} Plan`);
  const [row] = await serviceRest<{ id: string }[]>("doqtri", "documents", {
    method: "POST",
    body: { user_id: userId, workspace_id: workspaceId, title, markdown: PLAN(title) },
  });
  return { id: row.id, title };
}

/** Removes a note, taking its qdit links with it in doqtri (a linked note refuses deletion, D-68). */
export async function deleteNote(id: string): Promise<void> {
  await serviceRest("doqtri", `doc_project_links?document_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  await serviceRest("doqtri", `documents?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

/* -------------------------------------------------------------------------- */
/* Connecting doqtri to qdit                                                  */
/* -------------------------------------------------------------------------- */

/**
 * doqtri's own connect flow, end to end: doqtri -> qdit's OAuth server ->
 * qdit's /oauth/consent -> doqtri's callback -> doqtri's Connected apps.
 * The context must already be signed in to both apps.
 */
export async function connectThroughDoqtri(page: Page, decision: "approve" | "deny" = "approve"): Promise<void> {
  const e = env();
  await page.goto(`${e.doqtriOrigin}/api/integrations/qdit/connect`);
  await page.waitForURL((url) => url.origin === e.qditOrigin && url.pathname === "/oauth/consent", { timeout: 30_000 });
  await consent(page, decision);
  await page.waitForURL((url) => url.origin === e.doqtriOrigin && url.pathname.startsWith("/vault/profile"), {
    timeout: 30_000,
  });
}

/**
 * Answers qdit's consent screen. qdit shows it only once per grant; a
 * returning user with a live grant is sent straight on, and then there is
 * nothing to click.
 */
async function consent(page: Page, decision: "approve" | "deny"): Promise<void> {
  const button =
    decision === "approve"
      ? page.getByRole("button", { name: /^Allow / })
      : page.getByRole("button", { name: "Deny" });
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
}

/** Drops doqtri's stored connection for a user so each spec starts disconnected. */
export async function dropDoqtriConnection(doqtriUserId: string): Promise<void> {
  await serviceRest("doqtri", `integration_connections?user_id=eq.${doqtriUserId}&provider=eq.qdit`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

/**
 * A token for doqtri's client, issued by the real qdit OAuth server for the
 * signed-in qdit user in `context`.
 *
 * doqtri keeps its tokens sealed and server-side, so to check qdit's side of
 * the contract with a doqtri-client token the suite runs the same
 * authorization-code + PKCE grant doqtri runs, with doqtri's registered
 * redirect URI. The browser's redirect to doqtri's callback is intercepted
 * before doqtri can spend the code; the suite spends it instead, with the
 * client secret, exactly as doqtri's callback would.
 */
export async function clientToken(context: BrowserContext): Promise<{ access: string; refresh: string | null }> {
  const e = env();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  const redirectUri = callbackOf(e);

  const authorize = new URL(`${issuerOf(e)}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", e.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", "openid");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const page = await context.newPage();
  let landed: URL | null = null;
  try {
    // A route handler sees only the first URL of a redirect chain. With a live
    // grant, qdit answers the authorize request with server redirects that end
    // at doqtri's callback, so a handler on the callback URL alone never fires
    // and doqtri spends the code. Every navigation is therefore fetched one hop
    // at a time, and the hop that points at the callback is stopped there.
    const isCallback = (url: string) => url.startsWith(redirectUri);
    const capture = async (route: Route, url: string) => {
      landed = new URL(url);
      await route.fulfill({ status: 200, contentType: "text/plain", body: "captured by the integration suite" });
    };
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (isCallback(request.url())) return capture(route, request.url());
      if (!request.isNavigationRequest()) return route.continue();
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers()["location"];
      if (location && response.status() >= 300 && response.status() < 400) {
        const next = new URL(location, request.url()).toString();
        if (isCallback(next)) return capture(route, next);
        // Hand the hop back as a page that navigates on, so the next request
        // is a fresh navigation this handler sees too. The hop's own headers
        // (its cookies) are kept.
        const headers = { ...response.headers() };
        // The redirecting server's own CSP would block the script below.
        for (const name of ["location", "content-length", "content-security-policy", "content-security-policy-report-only"]) {
          delete headers[name];
        }
        headers["content-type"] = "text/html";
        return route.fulfill({
          status: 200,
          headers,
          body: `<!doctype html><meta http-equiv="refresh" content="0;url=${next.replace(/"/g, "&quot;")}"><script>location.replace(${JSON.stringify(next)})</script>`,
        });
      }
      await route.fulfill({ response });
    });
    await page.goto(authorize.toString());
    // Either the consent screen, or (a grant already exists) straight to the callback.
    const consentShown = await page
      .getByRole("button", { name: /^Allow / })
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (consentShown) await page.getByRole("button", { name: /^Allow / }).click();
    await expect
      .poll(() => landed, { timeout: 30_000, message: `the authorize redirect never reached doqtri's callback; the page is at ${page.url()}` })
      .not.toBeNull();
  } finally {
    await page.close();
  }

  const url = landed as URL | null;
  expect(url?.searchParams.get("state")).toBe(state);
  const code = url?.searchParams.get("code");
  expect(code, `no code on the redirect: ${url?.search}`).toBeTruthy();

  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+");
  const res = await fetch(`${issuerOf(e)}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${encode(e.clientId)}:${encode(e.clientSecret)}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code: code!, redirect_uri: redirectUri, code_verifier: verifier }),
  });
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string };
  expect(res.status, body.error ?? "").toBe(200);
  return { access: body.access_token!, refresh: body.refresh_token ?? null };
}

/** qdit's /api/v1, called with a bearer token. */
export async function api(token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${env().qditOrigin}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Decodes a JWT's payload without verifying it; qdit has already verified it. */
export function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Driving doqtri's integration routes as the signed-in doqtri user            */
/* -------------------------------------------------------------------------- */

export async function linkNoteToProject(context: BrowserContext, docId: string, projectId: string): Promise<void> {
  const res = await context.request.post(`${env().doqtriOrigin}/api/integrations/qdit/docs/${docId}/project`, {
    data: { projectId },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** Makes a qdit milestone from a heading, through doqtri. Returns doqtri's node_links row. */
export async function milestoneFromHeading(
  context: BrowserContext,
  docId: string,
  heading: { nodeId: string; nodeLabel: string },
): Promise<{ id: string; qdit_milestone_id: string; qdit_link_id: string }> {
  const res = await context.request.post(`${env().doqtriOrigin}/api/integrations/qdit/docs/${docId}/milestones`, {
    data: heading,
  });
  expect(res.status(), await res.text()).toBe(201);
  const [row] = await serviceRest<{ id: string; qdit_milestone_id: string; qdit_link_id: string }[]>(
    "doqtri",
    `node_links?document_id=eq.${docId}&provider=eq.qdit&node_id=eq.${heading.nodeId}&select=id,qdit_milestone_id,qdit_link_id`,
  );
  expect(row, "doqtri recorded no node link").toBeTruthy();
  return row;
}

/* -------------------------------------------------------------------------- */
/* Cleanup                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Deletes what one spec made. Order matters on qdit: a project's delete
 * cascades to its doc links, milestones, links and outbox rows.
 */
export async function cleanUp(made: { projects?: QditProject[]; notes?: { id: string }[] }): Promise<void> {
  for (const note of made.notes ?? []) await deleteNote(note.id).catch(() => undefined);
  for (const project of made.projects ?? []) {
    // doqtri's per-milestone state rows have no foreign key to its links.
    await serviceRest("doqtri", `qdit_milestone_states?project_id=eq.${project.id}`, {
      method: "DELETE",
      prefer: "return=minimal",
    }).catch(() => undefined);
    await serviceRest("qdit", `projects?id=eq.${project.id}`, { method: "DELETE", prefer: "return=minimal" }).catch(
      () => undefined,
    );
  }
}

/**
 * Opens the doqtri doc card for a plan doc on qdit's project page and returns
 * it. The card lives in a popover behind the Plan docs row's badge
 * ("Details", or "Connection lost"), whose accessible name starts with the
 * doc's title in quotes.
 */
export async function openPlanDocCard(page: Page, docTitle: string) {
  const trigger = page.getByRole("button", { name: new RegExp(`^"${docTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":`) });
  await expect(trigger).toBeVisible({ timeout: 20_000 });
  await trigger.click();
  return page.locator('[data-slot="doqtri-doc-card"]');
}

/* -------------------------------------------------------------------------- */
/* Hackathon (07-hackathon.spec.ts)                                           */
/* -------------------------------------------------------------------------- */

/** Hackathons and qdit member accounts that 07-hackathon.spec.ts makes. */
export const HACKATHON_SLUG_PREFIX = `${SLUG_PREFIX}hackathon-`;
export const MEMBER_USERNAME_PREFIX = "dqit_h_";

export function qditAuthHeaders() {
  const key = env().qditSecretKey;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Deletes a hackathon's mindmap objects, then the hackathon (cascades to its snapshots and entries). */
export async function removeHackathon(id: string): Promise<void> {
  const svc = {
    url: env().qditSupabaseUrl.replace(/\/+$/, ""),
    headers: { ...qditAuthHeaders(), "Content-Type": "application/json", Prefer: "return=representation" },
  };
  const paths = await storagePaths(svc, id);
  if (paths.length > 0) {
    await fetch(`${svc.url}/storage/v1/object/hackathon-mindmaps`, {
      method: "DELETE",
      headers: { ...qditAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
  }
  await serviceRest("qdit", `hackathons?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

/** Deletes qdit accounts by id. */
export async function removeQditAccounts(ids: string[]): Promise<void> {
  for (const id of ids) {
    await fetch(`${env().qditSupabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: qditAuthHeaders(),
    });
  }
}
