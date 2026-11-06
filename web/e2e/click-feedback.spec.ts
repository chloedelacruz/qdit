import { expect, test, type Page } from "@playwright/test";

/**
 * A click must look registered even when the next page is slow (QDIT-35).
 *
 * The server is made slow on purpose: every RSC request — the payload a
 * client-side navigation fetches — is held for a second, which is the case
 * that used to show nothing at all between the click and the new page.
 *
 * Prefetches are refused, and this goes in before the page loads. A finished
 * prefetch makes the navigation instant, and the bar is built not to flash on
 * an instant one, so otherwise these would race the prefetch (QDIT-38).
 */

async function slowNavigations(page: Page) {
  await page.route("**/*", async (route) => {
    const headers = route.request().headers();
    if (headers["next-router-prefetch"]) return route.abort();
    if (headers["rsc"]) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    await route.continue();
  });
}

const bar = (page: Page) => page.getByRole("progressbar", { name: "Loading page", includeHidden: true });

test.describe("click feedback", () => {
  test("the progress bar and the pending nav item show at once, then clear", async ({ page }) => {
    await slowNavigations(page);
    await page.goto("/dashboard");
    await expect(bar(page)).toHaveAttribute("data-state", "idle");

    const settings = page
      .getByRole("navigation")
      .getByRole("link", { name: "Settings", exact: true })
      .first();
    await settings.click();

    await expect(bar(page)).toHaveAttribute("data-state", "loading");
    await expect(bar(page)).toHaveCSS("opacity", "1");

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
    await expect(bar(page)).toHaveAttribute("data-state", "idle");
  });

  test("with Reduce Motion the bar is a still, full-width line", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await slowNavigations(page);
    await page.goto("/dashboard");

    await page.getByRole("navigation").getByRole("link", { name: "Wallet", exact: true }).first().click();

    await expect(bar(page)).toHaveCSS("opacity", "1");
    const inner = bar(page).locator(".nav-progress-bar");
    await expect(inner).toHaveCSS("animation-name", "none");
    const widths = await inner.evaluate((element) => [
      element.getBoundingClientRect().width,
      element.parentElement!.getBoundingClientRect().width,
    ]);
    expect(widths[0]).toBeCloseTo(widths[1], 0);

    await expect(page).toHaveURL(/\/wallet$/);
  });

  test("a spinner keeps turning under Reduce Motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");
    // Any spinner on the page will do; inject one so the check needs no data.
    const iterations = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.className = "animate-spin";
      document.body.append(probe);
      const value = getComputedStyle(probe).animationIterationCount;
      probe.remove();
      return value;
    });
    expect(iterations).toBe("infinite");
  });

  test("Settings and Wallet have an instant loading fallback", async ({ page }) => {
    await page.goto("/dashboard");
    await slowNavigations(page);

    await page.getByRole("navigation").getByRole("link", { name: "Settings", exact: true }).first().click();
    // The skeleton from app/(app)/loading.tsx, before the page itself arrives.
    await expect(page.locator('main [aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  });
});
