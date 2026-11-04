/**
 * The people in the suite, and how each one signs in to each app.
 *
 * Both apps sign people in with a wallet. Neither sign-in touches the ledger:
 * qdit verifies a SEP-10 challenge it never submits, and doqtri verifies a
 * SEP-53 message signature. So the wallets are derived from a public seed
 * (DOQTRI_IT_SEED plus a label), are never funded, and exist only in the two
 * non-production projects. The same seed gives the same accounts on every
 * run, so the suite does not leave a new account behind each time.
 */
import { createHash } from "node:crypto";
import { expect, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

import { env } from "./env";
import { serviceRest } from "./rest";

export function keypairFor(label: string): Keypair {
  return Keypair.fromRawEd25519Seed(createHash("sha256").update(`${env().seed}/${label}`).digest());
}

function shortHash(label: string): string {
  return createHash("sha256").update(`${env().seed}/${label}/id`).digest("hex").slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* qdit                                                                       */
/* -------------------------------------------------------------------------- */

async function qditConnect(context: BrowserContext, keypair: Keypair): Promise<string> {
  const origin = env().qditOrigin;
  const challenge = await context.request.post(`${origin}/api/auth/wallet/challenge`, {
    data: { address: keypair.publicKey() },
  });
  expect(challenge.ok(), await challenge.text()).toBeTruthy();
  const { xdr } = (await challenge.json()) as { xdr: string };

  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  tx.sign(keypair);
  const verify = await context.request.post(`${origin}/api/auth/wallet/verify`, {
    data: { signedXdr: tx.toXDR(), intent: "sign-in" },
  });
  expect(verify.ok(), await verify.text()).toBeTruthy();
  return ((await verify.json()) as { status: string }).status;
}

/**
 * Signs `label`'s wallet in to qdit in `context`, registering the account the
 * first time (the same /register form a person fills in). The session cookies
 * land in the context, so qdit pages and the OAuth consent screen see a
 * signed-in user.
 */
export async function signInToQdit(context: BrowserContext, label: string): Promise<QditUser> {
  const keypair = keypairFor(`qdit/${label}`);
  const status = await qditConnect(context, keypair);

  if (status === "registration-required") {
    const id = shortHash(`qdit/${label}`);
    const page = await context.newPage();
    try {
      await page.goto(`${env().qditOrigin}/register`);
      await page.getByLabel("Username").fill(`dqit_${id}`);
      await page.getByLabel("Email").fill(`dqit-${id}@qdit.test`);
      await page.getByLabel("Password").fill(`dqit-${id}-not-a-secret`);
      await page.getByRole("button", { name: "Create account" }).click();
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    } finally {
      await page.close();
    }
  } else {
    expect(status).toBe("signed-in");
  }

  const [profile] = await serviceRest<{ id: string; username: string }[]>(
    "qdit",
    `profiles?wallet_address=eq.${keypair.publicKey()}&select=id,username`,
  );
  expect(profile, `qdit has no profile bound to ${keypair.publicKey()}`).toBeTruthy();
  return { id: profile.id, username: profile.username, address: keypair.publicKey() };
}

export type QditUser = { id: string; username: string; address: string };

/* -------------------------------------------------------------------------- */
/* doqtri                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Signs `label`'s wallet in to doqtri in `context`, the way doqtri's own e2e
 * suite does: challenge, SEP-53 signature, /api/auth/wallet, then the session
 * written as @supabase/ssr cookies (doqtri's server components read cookies,
 * not localStorage). The first sign-in creates the account and its personal
 * workspace.
 */
export async function signInToDoqtri(context: BrowserContext, label: string): Promise<DoqtriUser> {
  const e = env();
  const keypair = keypairFor(`doqtri/${label}`);
  const address = keypair.publicKey();

  const challenge = await context.request.post(`${e.doqtriOrigin}/api/auth/wallet/challenge`, { data: { address } });
  expect(challenge.ok(), await challenge.text()).toBeTruthy();
  const { message, token } = (await challenge.json()) as { message: string; token: string };
  const signature = Buffer.from(keypair.signMessage(message)).toString("base64");

  const res = await context.request.post(`${e.doqtriOrigin}/api/auth/wallet`, { data: { address, token, signature } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const tokens = (await res.json()) as { access_token: string; refresh_token: string };

  const jar = new Map<string, string>();
  const supabase = createServerClient(e.doqtriSupabaseUrl, e.doqtriAnonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.setSession(tokens);
  expect(error, error?.message).toBeNull();

  const { hostname, protocol } = new URL(e.doqtriOrigin);
  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, domain: hostname, path: "/", secure: protocol === "https:", sameSite: "Lax" as const })),
  );

  const [row] = await serviceRest<{ user_id: string }[]>("doqtri", `wallet_accounts?address=eq.${address}&select=user_id`);
  expect(row, `doqtri has no account for ${address}`).toBeTruthy();
  const [workspace] = await serviceRest<{ id: string }[]>(
    "doqtri",
    `workspaces?created_by=eq.${row.user_id}&is_personal=eq.true&select=id`,
  );
  expect(workspace, "doqtri made no personal workspace").toBeTruthy();
  return { id: row.user_id, address, workspaceId: workspace.id };
}

export type DoqtriUser = { id: string; address: string; workspaceId: string };
