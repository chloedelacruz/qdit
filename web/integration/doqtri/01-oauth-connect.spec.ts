import { expect, test } from "@playwright/test";

import { env, issuerOf } from "./env";
import { doqtriAppsPanel, openPair, startDisconnected, type Pair } from "./pair";
import { serviceRest } from "./rest";
import { api, claims, clientToken, connectThroughDoqtri } from "./world";

/**
 * Connection 1, OAuth connect (WP-2.2, WP-2.3; contract section 5).
 *
 * doqtri sends the person to qdit's OAuth server with PKCE, qdit's
 * /oauth/consent asks, and doqtri's callback stores the tokens. Everything
 * here is the two real apps and qdit's real Supabase Auth.
 */

let pair: Pair;

test.beforeAll(async ({ browser }) => {
  pair = await openPair(browser);
  await startDisconnected(pair);
});

test.afterAll(async () => {
  await pair?.context.close();
});

test("declining on qdit's consent screen connects nothing", async () => {
  await connectThroughDoqtri(pair.page, "deny");
  await expect(pair.page.getByTestId("qdit-outcome")).toHaveText(
    "You didn't allow Doqtri in qdit, so nothing was connected.",
  );
  await expect(await doqtriAppsPanel(pair.page)).not.toHaveText("Connected");

  const rows = await serviceRest<unknown[]>(
    "doqtri",
    `integration_connections?user_id=eq.${pair.doqtri.id}&provider=eq.qdit&status=eq.connected&select=user_id`,
  );
  expect(rows).toEqual([]);
});

test("allowing connects doqtri as the qdit account that consented", async () => {
  await connectThroughDoqtri(pair.page, "approve");
  await expect(pair.page.getByTestId("qdit-outcome")).toHaveText("qdit is connected.");
  await expect(await doqtriAppsPanel(pair.page)).toHaveText("Connected");

  // doqtri asked qdit's /api/v1/me who this is and stored that subject.
  const [row] = await serviceRest<{ subject: string; status: string; access_token_ciphertext: string | null }[]>(
    "doqtri",
    `integration_connections?user_id=eq.${pair.doqtri.id}&provider=eq.qdit&select=subject,status,access_token_ciphertext`,
  );
  expect(row).toMatchObject({ subject: pair.qdit.id, status: "connected" });
  expect(row.access_token_ciphertext, "doqtri stored no sealed token").toBeTruthy();

  // qdit lists the grant under Authorized apps.
  await pair.page.goto(`${env().qditOrigin}/settings`);
  await expect(
    pair.page.locator("li").filter({ hasText: new URL(env().doqtriOrigin).host }).getByRole("button", { name: "Revoke" }),
  ).toBeVisible();
});

test("the token qdit issues is doqtri's client, by UUID, and /api/v1 accepts it (D-77)", async () => {
  const { access } = await clientToken(pair.context);
  const c = claims(access);
  expect(c.iss).toBe(issuerOf(env()));
  expect(c.role).toBe("authenticated");
  expect(c.sub).toBe(pair.qdit.id);
  expect(c.client_id).toBe(env().clientId);

  const me = await api(access, "GET", "/me");
  expect(me.status).toBe(200);
  const body = (await me.json()) as { data: { user: { id: string }; client_id: string } };
  expect(body.data.user.id).toBe(pair.qdit.id);
  expect(body.data.client_id).toBe(env().clientId);
});

test("/api/v1 refuses a tampered token, and a first-party session token", async () => {
  const { access } = await clientToken(pair.context);
  const [h, p, s] = access.split(".");
  const tampered = `${h}.${p}.${s.slice(0, -4)}${s.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
  const refused = await api(tampered, "GET", "/me");
  expect(refused.status).toBe(401);
  expect(refused.headers.get("www-authenticate")).toContain('error="invalid_token"');
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("unauthorized");

  // qdit's own browser session: a valid qdit JWT with no client_id.
  const cookies = await pair.context.cookies(env().qditOrigin);
  const auth = cookies.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  expect(auth.length, "no qdit session cookie in the context").toBeGreaterThan(0);
  const raw = auth.map((c) => c.value).join("");
  const session = JSON.parse(
    raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64").toString("utf8") : decodeURIComponent(raw),
  ) as { access_token: string };
  expect(claims(session.access_token).client_id ?? null).toBeNull();
  const firstParty = await api(session.access_token, "GET", "/me");
  expect(firstParty.status).toBe(401);
});
