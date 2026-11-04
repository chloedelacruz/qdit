import { createHash, randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

import { tag } from "./service";

/**
 * `/oauth/consent` and Settings › Authorized apps — the two screens a person
 * sees when another app, doqtri in practice, asks to act for them in qdit.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE AUTHORIZATION REQUEST COMES FROM
 * ---------------------------------------------------------------------------
 * The consent page only renders for an `authorization_id` that Supabase Auth
 * issued, and Auth only issues one for a registered OAuth client. So this spec
 * registers a client of its own through the Auth admin API, starts a real
 * PKCE authorization against `/auth/v1/oauth/authorize`, and reads the
 * `authorization_id` out of the redirect Auth answers with.
 *
 * It does not follow that redirect. Auth points it at the project's Site URL,
 * which is the deployed app, not the one under test. The id is not tied to a
 * host, so the spec opens this server's own `/oauth/consent` with it, signed
 * in as the e2e account, and from there everything is the app's real code:
 * the page asks Auth for the request, the buttons call the Server Action, and
 * the action redirects to the client's `redirect_uri`.
 *
 * The client's redirect URI is a path on this server that does not exist. The
 * browser lands on a 404 there with the `code` (or the `error`) in its URL,
 * which is all an app's callback would get.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS COSTS, AND WHEN IT SKIPS
 * ---------------------------------------------------------------------------
 * One OAuth client per run, named `e2e oauth client …`, deleted in `afterAll`
 * and swept by `cleanup.teardown.ts` after a crashed run. Deleting the client
 * removes its grant. The e2e account's other apps — doqtri's real connection
 * among them — are never touched: the revoke test acts on this client's row
 * only.
 *
 * The approve, deny and revoke tests need the project's OAuth 2.1 server to be
 * enabled (Authentication › OAuth Server) and the secret key to register a
 * client. Without either they skip with the reason; the tests above them,
 * which need neither, still run.
 */

const CALLBACK = "/e2e/oauth/callback";

/**
 * The server under test, worked out the way `playwright.config.ts` does.
 * `beforeAll` cannot take the test-scoped `baseURL` fixture.
 */
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${Number(process.env.PORT ?? 3100)}`;

type Client = { id: string; name: string; redirectUri: string };

function auth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  return url && secret ? { url, secret } : null;
}

let client: Client | null = null;
let skipReason = "";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Starts an authorization for `client` and returns the id Auth issued.
 * Fresh each time: an id is single-use once a decision is made on it.
 */
async function startAuthorization(
  request: APIRequestContext,
  state: string,
): Promise<{ authorizationId: string; verifier: string }> {
  const { url } = auth()!;
  const { verifier, challenge } = pkce();

  const query = new URLSearchParams({
    response_type: "code",
    client_id: client!.id,
    redirect_uri: client!.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "openid email profile",
    state,
  });

  const response = await request.get(`${url}/auth/v1/oauth/authorize?${query}`, {
    maxRedirects: 0,
  });
  expect(
    [302, 303].includes(response.status()),
    `authorize answered ${response.status()}: ${await response.text()}`,
  ).toBe(true);

  const location = new URL(response.headers()["location"]!);
  const authorizationId = location.searchParams.get("authorization_id");
  expect(authorizationId, `no authorization_id in ${location.pathname}`).toBeTruthy();

  return { authorizationId: authorizationId!, verifier };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const baseURL = BASE_URL;
  const credentials = auth();
  if (!credentials) {
    skipReason = "SUPABASE_SECRET_KEY is not set, so no OAuth client can be registered.";
    return;
  }

  const name = `e2e oauth client ${tag()}`;
  const redirectUri = new URL(CALLBACK, baseURL).toString();

  const response = await fetch(`${credentials.url}/auth/v1/admin/oauth/clients`, {
    method: "POST",
    headers: {
      apikey: credentials.secret,
      Authorization: `Bearer ${credentials.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_name: name,
      client_uri: baseURL,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!response.ok) {
    // 404 is the OAuth server being off for this project; anything else is
    // reported with its body so the reason is in the skip message.
    skipReason =
      `Registering an OAuth client failed (${response.status}): ${await response.text()}. ` +
      "Enable the OAuth 2.1 server for the e2e Supabase project (Authentication › OAuth Server).";
    return;
  }

  const created = (await response.json()) as { client_id: string };
  client = { id: created.client_id, name, redirectUri };
});

test.afterAll(async () => {
  const credentials = auth();
  if (!credentials || !client) return;

  await fetch(`${credentials.url}/auth/v1/admin/oauth/clients/${client.id}`, {
    method: "DELETE",
    headers: { apikey: credentials.secret, Authorization: `Bearer ${credentials.secret}` },
  });
});

test.describe("consent screen without a request", () => {
  test("a link missing its request says so, and offers no buttons", async ({ page }) => {
    await page.goto("/oauth/consent");

    await expect(
      page.getByText("This link is missing its request. Go back to the app and connect again."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Allow/ })).toHaveCount(0);
  });

  test("a request Auth does not recognise reads as expired", async ({ page }) => {
    await page.goto("/oauth/consent?authorization_id=e2e-not-a-real-request");

    await expect(
      page.getByText("This sign-in request has expired or was already used.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Deny" })).toHaveCount(0);
  });
});

test.describe("consent screen, signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sends the visitor to sign in and carries the request along", async ({ page }) => {
    await page.goto("/oauth/consent?authorization_id=e2e-signed-out-request");

    await expect(page).toHaveURL(/\/login\?/);
    const next = new URL(page.url()).searchParams.get("next");
    expect(next).toBe("/oauth/consent?authorization_id=e2e-signed-out-request");
  });
});

test.describe("deciding a real request", () => {
  test.beforeEach(() => {
    test.skip(!client, skipReason);
  });

  // Deny runs first: an approval is remembered, and Auth would then answer
  // the next request for this client with a redirect instead of a question.
  test("deny goes back to the app with access_denied and no code", async ({ page }) => {
    const { authorizationId } = await startAuthorization(page.request, "e2e-deny");

    await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: `Connect ${client!.name} to qdit` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Deny" }).click();
    await page.waitForURL((url) => url.pathname === CALLBACK);

    const back = new URL(page.url()).searchParams;
    expect(back.get("error")).toBe("access_denied");
    expect(back.get("code")).toBeNull();
    expect(back.get("state")).toBe("e2e-deny");
  });

  test("the screen names the app, the account, the scopes and where it returns", async ({
    page,
  }) => {
    const { authorizationId } = await startAuthorization(page.request, "e2e-look");
    await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);

    await expect(page.getByText("Signed in as")).toBeVisible();
    await expect(page.getByText(process.env.E2E_EMAIL!, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "It will be able to" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "It will not be able to" })).toBeVisible();
    await expect(page.getByText(new URL(client!.redirectUri).host).first()).toBeVisible();
    await expect(page.getByRole("button", { name: `Allow ${client!.name}` })).toBeEnabled();
  });

  test("allow goes back to the app with a code that exchanges for tokens", async ({ page }) => {
    const { authorizationId, verifier } = await startAuthorization(page.request, "e2e-allow");

    await page.goto(`/oauth/consent?authorization_id=${authorizationId}`);
    await page.getByRole("button", { name: `Allow ${client!.name}` }).click();
    await page.waitForURL((url) => url.pathname === CALLBACK);

    const back = new URL(page.url()).searchParams;
    expect(back.get("error")).toBeNull();
    expect(back.get("state")).toBe("e2e-allow");
    const code = back.get("code");
    expect(code).toBeTruthy();

    // The code is real: the app's server would trade it for tokens next, and
    // Auth hands them over only for this verifier.
    const { url } = auth()!;
    const token = await page.request.post(`${url}/auth/v1/oauth/token`, {
      form: {
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: client!.redirectUri,
        client_id: client!.id,
        code_verifier: verifier,
      },
    });
    expect(token.status(), await token.text()).toBe(200);
    expect(((await token.json()) as { access_token?: string }).access_token).toBeTruthy();
  });

  test("Settings lists the app, and revoking it removes it", async ({ page }) => {
    await page.goto("/settings");

    const row = page.getByRole("listitem").filter({ hasText: client!.name });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Revoke" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText(`Disconnect ${client!.name}?`)).toBeVisible();
    await dialog.getByRole("button", { name: "Revoke" }).click();

    await expect(page.getByText(`${client!.name} disconnected`)).toBeVisible();

    // Gone from the server's answer, not only from the page's state.
    await page.reload();
    await expect(page.getByText("Authorized apps", { exact: true })).toBeVisible();
    await expect(page.getByText(client!.name)).toHaveCount(0);
  });
});
