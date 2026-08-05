import { expect, test } from "@playwright/test";

import { PROJECT } from "./seed";

/**
 * Nothing here hardcodes a strkey or a hash: each test reads the real value out
 * of the DOM and asserts the *treatment* of it, so the suite survives a reseed.
 */
test.describe("stellar proof fields", () => {
  test("contract IDs are middle-truncated but keep the full value available", async ({
    page,
  }) => {
    await page.goto(`/projects/${PROJECT.slug}`);

    const hash = page.locator('[data-slot="hash"]').first();
    const full = await hash.getAttribute("title");

    expect(full).toMatch(/^C[A-Z2-7]{55}$/);

    // Both ends survive truncation, because that is how strkeys are compared
    // by eye. The overview renders 8 characters each side.
    const shown = (await hash.innerText()).trim();
    expect(shown).toBe(`${full!.slice(0, 8)}…${full!.slice(-8)}`);
  });

  /**
   * Only the testnet mapping is asserted: nothing Mainnet is seeded, so a
   * `public` assertion here would be testing a fixture rather than the app.
   * The mainnet branch (`mainnet` -> `public`) is exercised by the identifier
   * lookup in proofs.spec.ts, which renders a Mainnet explorer link for an
   * unknown contract id.
   */
  test("explorer links use the right network segment", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}`);

    const contractId = await page
      .locator('[data-slot="hash"]')
      .first()
      .getAttribute("title");

    await expect(
      page.getByRole("link", { name: "View contract on stellar.expert" }).first(),
    ).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/contract/${contractId}`,
    );
  });

  test("explorer links open in a new tab without leaking the opener", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}`);

    const link = page.getByRole("link", { name: /on stellar.expert/ }).first();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("copy button writes the full hash to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/projects/${PROJECT.slug}/proofs`);

    // Scoped to the transaction chip, not "the first hash on the row": proof
    // rows now also carry the signer's account strkey, which is a
    // `[data-slot="hash"]` too, so `.first()` meant "the tx hash" only by
    // accident of DOM order.
    //
    // Anchored on the explorer link rather than the copy button, because the
    // copy button relabels itself to "Copied" on click — a filter keyed to it
    // stops matching the moment the test acts on it, and every later assertion
    // resolves against nothing.
    const chip = page
      .locator("span")
      .filter({ has: page.getByRole("link", { name: "View transaction on stellar.expert" }) })
      .first();
    const expected = await chip.locator('[data-slot="hash"]').getAttribute("title");

    await chip.getByRole("button", { name: "Copy transaction" }).click();

    // The button flips to a confirmation state, then reverts.
    await expect(chip.getByRole("button", { name: "Copied" })).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(expected);
    expect(clipboard).toMatch(/^[0-9a-f]{64}$/);

    await expect(chip.getByRole("button", { name: "Copy transaction" })).toBeVisible({
      timeout: 5_000,
    });
  });

  /**
   * Skipped rather than deleted, so the coverage gap stays visible: every
   * seeded project has been deployed, so there is no contract-less project to
   * assert against. Seed one that has never reached Testnet and remove the
   * skip — the branch it covers (`project.contractId === null`) is live code in
   * the project overview.
   */
  test.skip("projects without a contract render no proof chip", async ({ page }) => {
    await page.goto("/projects/never-deployed");

    await expect(page.locator('[data-slot="hash"]')).toHaveCount(0);
  });
});
