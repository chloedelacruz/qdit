import { Keypair } from "@stellar/stellar-sdk";
import { expect, test } from "@playwright/test";

import { fund, giveWallet } from "./test-wallet";

/**
 * Creating a project asks the wallet first, and the project exists only once
 * the wallet has confirmed (QDIT-36).
 *
 * The flow under test: New project, enter details, Create project, wait for
 * the wallet, confirm, Project created. The test wallet starts installed but
 * not connected, which is where most owners will be, so the chooser renders
 * inside the dialog. A Friendbot-funded keypair signs, `create_project_ref`
 * lands on Testnet, and the project page shows it on chain, owned by that
 * keypair.
 *
 * Writes a project row, named with the `e2e project` prefix the teardown
 * removes. It runs in the `publishing` project, after the specs that assert
 * exact counts. The registration stays on Testnet, under an id nothing reuses.
 * Skipped where anchoring is off, as in CI.
 */
test.skip(
  !process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID,
  "Anchoring is not configured for this deployment.",
);

const unique = (noun: string) =>
  `e2e ${noun} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
/** `unique()` yields only lowercase and digits, so the dialog's slug is this. */
const slugFor = (name: string) => name.replace(/[^a-z0-9]+/g, "-");

async function openNewProject(page: import("@playwright/test").Page, name: string) {
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
}

test("the wallet confirms first, then the project is created, registered", async ({ page }) => {
  test.setTimeout(120_000);

  const keypair = Keypair.random();
  await fund(keypair.publicKey());
  await giveWallet(page, keypair);

  const name = unique("project");
  await openNewProject(page, name);

  // Waiting for the wallet. Nothing exists yet, and the chooser is inside the
  // dialog, which is still open.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Waiting for your wallet…" })).toBeVisible();
  await expect(page.getByText("Project created", { exact: true })).toHaveCount(0);
  await dialog.locator("li", { hasText: "Hana Wallet" }).click({ timeout: 20_000 });

  // Confirmed: only now is it created.
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText("Project created", { exact: true })).toBeVisible();

  await page.goto(`/projects/${slugFor(name)}`);
  const chain = page.locator("#chain");
  await expect(chain.getByText("On chain", { exact: true })).toBeVisible();
  await expect(chain.getByRole("button", { name: "Register on chain" })).toHaveCount(0);
  // The owner is whoever signed, read back from the transaction.
  await expect(chain.locator(`[data-slot="hash"][title="${keypair.publicKey()}"]`)).toBeVisible();
});

test("closing the chooser creates nothing, and offers to create without registering", async ({
  page,
}) => {
  await giveWallet(page, Keypair.random());

  const name = unique("project");
  await openNewProject(page, name);

  const dialog = page.getByRole("dialog");
  const chooser = dialog.locator('[data-slot="wallet-chooser"]');
  await expect(chooser.locator("li", { hasText: "Hana Wallet" })).toBeVisible({ timeout: 20_000 });

  // While the wallet is asking, the dialog stays: closing it would strand the
  // chooser. Escape does nothing.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();

  // The chooser's own close is the way out: the last button in its header.
  await chooser.locator("header button").last().click();
  await expect(dialog.getByText("Signing was cancelled. Nothing was created.")).toBeVisible();

  // Then, and only then, the way past registration.
  await dialog.getByRole("button", { name: "Create without registering" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText("Project created", { exact: true })).toBeVisible();

  await page.goto(`/projects/${slugFor(name)}`);
  await expect(page.locator("#chain").getByText("Not on chain", { exact: true })).toBeVisible();
});
