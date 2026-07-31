import { expect, test } from "@playwright/test";

test.describe("deployments", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/deployments");
  });

  test("only lists projects that actually have a contract", async ({ page }) => {
    const cards = page.locator('[data-slot="card"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: "Builder Onboarding" })).toHaveCount(0);
  });

  test("pipeline fills to the current stage and no further", async ({ page }) => {
    // Atlas Escrow sits at "testnet" — stage 2 of 4.
    const atlas = page.getByRole("list", { name: "Atlas Escrow deployment pipeline" });
    await expect(atlas.locator('[data-reached="true"]')).toHaveCount(2);
    await expect(atlas.locator('[data-reached="false"]')).toHaveCount(2);

    // Proof Registry is live — every stage reached.
    const registry = page.getByRole("list", { name: "Proof Registry deployment pipeline" });
    await expect(registry.locator('[data-reached="true"]')).toHaveCount(4);
    await expect(registry.locator('[data-reached="false"]')).toHaveCount(0);
  });

  test("pipeline stages are named for screen readers", async ({ page }) => {
    const atlas = page.getByRole("list", { name: "Atlas Escrow deployment pipeline" });
    await expect(atlas).toContainText("Not Started");
    await expect(atlas).toContainText("Deployed to Testnet");
    await expect(atlas).toContainText("Ready for Mainnet");
    await expect(atlas).toContainText("Mainnet Live");
  });

  test("each card shows its network and status badge", async ({ page }) => {
    const registry = page.locator('[data-slot="card"]').filter({ hasText: "Proof Registry" });
    await expect(registry).toContainText("Mainnet");
    await expect(registry).toContainText("Mainnet Live");
  });
});
