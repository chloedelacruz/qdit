import { expect, test } from "@playwright/test";

import { PROJECT, PROOF_TOTAL } from "./seed";

/**
 * The proof registry is the product differentiator, so it gets the deepest
 * coverage: it must list records, filter by network, and answer "what is this
 * identifier?" when one is pasted in.
 */
test.describe("proof registry", () => {
  const counter = (page: import("@playwright/test").Page) =>
    page.locator("text=/Showing .* proofs/").first();

  test("lists proof records with their project", async ({ page }) => {
    await page.goto("/proofs");

    await expect(counter(page)).toContainText(`Showing ${PROOF_TOTAL} of ${PROOF_TOTAL}`);
    await expect(page.getByText(PROJECT.name).first()).toBeVisible();
  });

  test("network is filterable", async ({ page }) => {
    // Everything seeded is on Testnet, so Mainnet must match nothing — and say
    // so rather than silently showing the unfiltered list.
    await page.goto("/proofs?network=mainnet");
    await expect(page.getByText(/No proofs match these filters/)).toBeVisible();

    await page.goto("/proofs?network=testnet");
    await expect(counter(page)).toContainText(`Showing ${PROOF_TOTAL}`);
  });

  test("pasting a contract ID resolves it to its project", async ({ page }) => {
    // Read a real contract ID out of the DOM rather than hardcoding one.
    await page.goto(`/projects/${PROJECT.slug}`);
    const contractId = await page
      .locator('[data-slot="hash"]')
      .first()
      .getAttribute("title");

    expect(contractId).toMatch(/^C[A-Z2-7]{55}$/);

    await page.goto(`/proofs?q=${contractId}`);

    await expect(page.getByText(/Found in \d+ record/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(PROJECT.name) }).first(),
    ).toHaveAttribute("href", `/projects/${PROJECT.slug}/proofs`);
  });

  test("a well-formed but unknown identifier says so and still links out", async ({
    page,
  }) => {
    const unknown = `C${"A".repeat(55)}`;
    await page.goto(`/proofs?q=${unknown}`);

    await expect(page.getByText("Not recorded in this workspace")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /View contract on stellar.expert/ }),
    ).toBeVisible();
  });

  test("a plain keyword searches notes without triggering identifier lookup", async ({
    page,
  }) => {
    await page.goto("/proofs?q=Testnet");

    await expect(page.getByText(/Found in \d+ record/)).toHaveCount(0);
    await expect(counter(page)).toContainText(`filtered from ${PROOF_TOTAL}`);
  });

  test("project scope narrows the registry to one project", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/proofs`);
    await expect(counter(page)).toContainText(`Showing ${PROOF_TOTAL} of ${PROOF_TOTAL}`);
  });
});
