import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * The whole auth flow, with a real wallet, without a wallet extension.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CAN EXIST AT ALL — AND WHY NO ACCOUNT IS FUNDED
 * ---------------------------------------------------------------------------
 * `WALLET-AUTH-PLAN.md` §11 says driving the browser wallet modal from
 * Playwright is not possible, and that is still true. What it does not say, and
 * what makes this spec possible, is that the modal is not the interesting part:
 * every wallet in the kit signs a transaction the same way, because the network
 * defines what a signature over a transaction means. So the test signs the
 * challenge itself, with a keypair it generates, and the server cannot tell the
 * difference — which is the point of a signature.
 *
 * The keypair is **never funded and never created on the ledger**, and this
 * spec never touches the network. A SEP-10 challenge is built with sequence
 * number 0 and is never submitted, and `verifyChallenge()` checks it with
 * `verifyChallengeTxSigners` against an explicit signer list rather than
 * `verifyChallengeTxThresholds`, which is the call that would have needed
 * Horizon to look up the account's real signers.
 *
 * That is worth stating because the obvious reading of the Doqtri load-testing
 * guide is that testing anything with a wallet needs `stellar keys generate`
 * and a Friendbot round trip. It does for *that* guide, whose simulated users
 * invoke a contract and pay fees. Signing in costs nothing and touches no
 * ledger, so an unfunded key that exists only inside this process is enough.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS COSTS
 * ---------------------------------------------------------------------------
 * It creates a real account in whatever Supabase project the suite points at.
 * Every identifier is prefixed `e2e-wallet-` / `e2e_w_` so
 * `cleanup.teardown.ts` can find and delete it, including after a crashed run.
 */

/** Signs the way the wallet kit does — same passphrase, same XDR shape. */
function sign(xdr: string, keypair: Keypair): string {
  const transaction = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  transaction.sign(keypair);
  return transaction.toXDR();
}

/**
 * Give each test its own apparent client address.
 *
 * `clientKey()` buckets the rate limiter on the first `x-forwarded-for` entry
 * and falls back to the literal string `unknown` when there is none — which
 * over loopback is every request. So without this the whole serial suite
 * shares one bucket, and the fifth registration in a minute is refused with
 * "Too many attempts" no matter which test asked for it. That is the limiter
 * working; it just makes six tests look like one abusive client.
 *
 * Set on the context, so it covers both `page.request` and the Server Action
 * POST the form makes — the action is rate-limited too, and it is a browser
 * request rather than an API one.
 */
let clientIp = "";

test.beforeEach(async ({ page }) => {
  const octet = () => 1 + Math.floor(Math.random() * 253);
  clientIp = `10.${octet()}.${octet()}.${octet()}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": clientIp });
});

/**
 * Connect: challenge, sign, verify.
 *
 * Runs on `page.request`, which shares the browser context's cookie jar — so
 * the session and the registration ticket land where the page will find them.
 * That sharing is the entire trick; an independent request context would get
 * the cookies and the page would not.
 */
async function connect(
  request: APIRequestContext,
  keypair: Keypair,
): Promise<{ status: string }> {
  // Stated explicitly as well as on the context: whether an APIRequestContext
  // inherits the context's extra headers is not something this spec should
  // depend on, and getting it wrong reappears as a flaky 429.
  const headers = { "x-forwarded-for": clientIp };

  const challenge = await request.post("/api/auth/wallet/challenge", {
    headers,
    data: { address: keypair.publicKey() },
  });
  expect(challenge.ok(), await challenge.text()).toBeTruthy();

  const { xdr } = (await challenge.json()) as { xdr: string };

  const verify = await request.post("/api/auth/wallet/verify", {
    headers,
    data: { signedXdr: sign(xdr, keypair), intent: "sign-in" },
  });
  expect(verify.ok(), await verify.text()).toBeTruthy();

  return (await verify.json()) as { status: string };
}

/** Unique per run, and greppable by the teardown. */
function identity() {
  const tag = Math.random().toString(36).slice(2, 10);
  return {
    username: `e2e_w_${tag}`,
    email: `e2e-wallet-${tag}@qdit.test`,
    password: `e2e-${tag}-password`,
  };
}

test.describe.configure({ mode: "serial" });

test.describe("wallet registration", () => {
  test("an unknown wallet is offered registration, not an account", async ({ page }) => {
    const keypair = Keypair.random();

    const { status } = await connect(page.request, keypair);
    expect(status).toBe("registration-required");

    // The ticket is what carries the proved address across to the form. The
    // address is rendered and not typed, so it must appear on the page.
    await page.goto("/register");
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Finish setting up");

    const address = keypair.publicKey();
    await expect(
      page.getByTitle(address).or(page.getByText(address.slice(0, 6), { exact: false })),
    ).toBeVisible();

    await expect(page.getByText("It cannot be changed later.")).toBeVisible();
  });

  test("registering creates the account and signs it in", async ({ page }) => {
    const keypair = Keypair.random();
    const me = identity();

    expect((await connect(page.request, keypair)).status).toBe("registration-required");

    await page.goto("/register");
    await page.getByLabel("Username").fill(me.username);
    await page.getByLabel("Email").fill(me.email);
    await page.getByLabel("Password").fill(me.password);
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // A brand-new account: signed in, and its own workspace is empty rather
    // than showing anybody else's rows.
    await expect(page.getByText("Milestone Proof Registry")).toHaveCount(0);

    // The username became the display name, and the address is bound.
    await page.goto("/settings");
    await expect(page.getByText(me.username).first()).toBeVisible();
    await expect(page.getByText("Signs you in. Cannot be changed.")).toBeVisible();
  });

  test("the same wallet then signs in with nothing typed", async ({ page }) => {
    const keypair = Keypair.random();
    const me = identity();

    // Register first, in this context.
    expect((await connect(page.request, keypair)).status).toBe("registration-required");
    await page.goto("/register");
    await page.getByLabel("Username").fill(me.username);
    await page.getByLabel("Email").fill(me.email);
    await page.getByLabel("Password").fill(me.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // Now throw the session away and connect the same wallet again. This is the
    // returning-user path, and it must ask for nothing at all.
    await page.context().clearCookies();
    expect((await connect(page.request, keypair)).status).toBe("signed-in");

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("one email cannot serve two wallets", async ({ page }) => {
    const first = Keypair.random();
    const second = Keypair.random();
    const me = identity();

    expect((await connect(page.request, first)).status).toBe("registration-required");
    await page.goto("/register");
    await page.getByLabel("Username").fill(me.username);
    await page.getByLabel("Email").fill(me.email);
    await page.getByLabel("Password").fill(me.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // A second, different wallet trying to register the same address.
    await page.context().clearCookies();
    expect((await connect(page.request, second)).status).toBe("registration-required");

    await page.goto("/register");
    await page.getByLabel("Username").fill(`${me.username}2`);
    await page.getByLabel("Email").fill(me.email);
    await page.getByLabel("Password").fill(me.password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
      page.getByText("That email is already used by another qdit account."),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/register/);
  });

  test("a username cannot be taken twice", async ({ page }) => {
    const first = Keypair.random();
    const second = Keypair.random();
    const me = identity();
    const other = identity();

    expect((await connect(page.request, first)).status).toBe("registration-required");
    await page.goto("/register");
    await page.getByLabel("Username").fill(me.username);
    await page.getByLabel("Email").fill(me.email);
    await page.getByLabel("Password").fill(me.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    await page.context().clearCookies();
    expect((await connect(page.request, second)).status).toBe("registration-required");

    await page.goto("/register");
    await page.getByLabel("Username").fill(me.username); // taken
    await page.getByLabel("Email").fill(other.email); // free
    await page.getByLabel("Password").fill(other.password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("That username is taken.")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("a signature for one wallet does not register another", async ({ page }) => {
    // The address is read out of the transaction the signature covers. Signing
    // a challenge issued for someone else's address must fail, or the whole
    // scheme is decoration.
    const victim = Keypair.random();
    const attacker = Keypair.random();

    const challenge = await page.request.post("/api/auth/wallet/challenge", {
      data: { address: victim.publicKey() },
    });
    expect(challenge.ok()).toBeTruthy();
    const { xdr } = (await challenge.json()) as { xdr: string };

    const verify = await page.request.post("/api/auth/wallet/verify", {
      data: { signedXdr: sign(xdr, attacker), intent: "sign-in" },
    });

    expect(verify.status()).toBe(401);
    await expect(page.goto("/register").then((r) => r?.url() ?? "")).resolves.toMatch(
      /\/login$/,
    );
  });
});
