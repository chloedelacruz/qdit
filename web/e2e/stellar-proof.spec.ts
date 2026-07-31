import { expect, test } from "@playwright/test";

const ATLAS_CONTRACT = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
const REGISTRY_CONTRACT = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const CONTRACT_V1_TX = "3f2a91d0c4b7e6158a0d9c2f7b4e18d63a5c0e9f2b7d4a16c8e35f907b1d2a4c";

test.describe("stellar proof fields", () => {
  test("contract IDs are middle-truncated but keep the full value available", async ({ page }) => {
    await page.goto("/projects");

    const hash = page.locator('[data-slot="hash"]').filter({ hasText: "CBQHNA" });

    // Six leading and six trailing characters — both ends survive truncation
    // because that is how strkeys get compared by eye.
    await expect(hash).toHaveText("CBQHNA…IMAO4K");
    await expect(hash).toHaveAttribute("title", ATLAS_CONTRACT);
  });

  test("explorer links use the right network segment", async ({ page }) => {
    await page.goto("/projects");

    // testnet stays "testnet"; mainnet maps to stellar.expert's "public".
    const atlasCard = page.locator('[data-slot="card"]').filter({ hasText: "Atlas Escrow" });
    await expect(
      atlasCard.getByRole("link", { name: "View contract on stellar.expert" }),
    ).toHaveAttribute("href", `https://stellar.expert/explorer/testnet/contract/${ATLAS_CONTRACT}`);

    const registryCard = page.locator('[data-slot="card"]').filter({ hasText: "Proof Registry" });
    await expect(
      registryCard.getByRole("link", { name: "View contract on stellar.expert" }),
    ).toHaveAttribute("href", `https://stellar.expert/explorer/public/contract/${REGISTRY_CONTRACT}`);
  });

  test("explorer links open in a new tab without leaking the opener", async ({ page }) => {
    await page.goto("/projects");

    const link = page.getByRole("link", { name: "View contract on stellar.expert" }).first();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("copy button writes the full hash to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/dashboard");

    const panel = page.locator('[data-slot="card"]').filter({ hasText: "Milestone proof" });
    await panel.getByRole("button", { name: "Copy transaction" }).first().click();

    // The button flips to a confirmation state, then reverts.
    await expect(panel.getByRole("button", { name: "Copied" }).first()).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(CONTRACT_V1_TX);

    await expect(panel.getByRole("button", { name: "Copy transaction" }).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test("projects without a contract render no proof chip", async ({ page }) => {
    await page.goto("/projects");

    const onboarding = page.locator('[data-slot="card"]').filter({ hasText: "Builder Onboarding" });
    await expect(onboarding).toBeVisible();
    await expect(onboarding.locator('[data-slot="hash"]')).toHaveCount(0);
  });
});
