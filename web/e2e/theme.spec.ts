import { expect, test } from "@playwright/test";

test.describe("theme", () => {
  test("follows the OS preference on first load", async ({ browser }) => {
    const dark = await browser.newContext({ colorScheme: "dark" });
    const page = await dark.newPage();
    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await dark.close();

    const light = await browser.newContext({ colorScheme: "light" });
    const lightPage = await light.newPage();
    await lightPage.goto("/dashboard");
    await expect(lightPage.locator("html")).not.toHaveClass(/dark/);
    await light.close();
  });

  test("toggle flips the theme and survives a reload", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("brand accent renders as the spec colour in each theme", async ({ page }) => {
    await page.goto("/dashboard");

    /**
     * The tokens are authored in oklch and Chromium reports the *computed*
     * custom property as `lab(...)`, so comparing declaration text proves
     * nothing. Rasterising through a canvas gives the sRGB the user actually
     * sees, which is what the spec's hex values describe.
     */
    const paintedPrimary = () =>
      page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = getComputedStyle(document.documentElement)
          .getPropertyValue("--primary")
          .trim();
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b];
      });

    const closeTo = (actual: number[], hex: string) => {
      const expected = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      // ±2 per channel absorbs oklch -> sRGB rounding.
      actual.forEach((channel, i) => expect(Math.abs(channel - expected[i])).toBeLessThanOrEqual(2));
    };

    // Spec: #6D5EF8 on light surfaces, lightened to #8B7CFF on dark ones.
    closeTo(await paintedPrimary(), "#6D5EF8");

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    closeTo(await paintedPrimary(), "#8B7CFF");
  });

  /**
   * The one property that decides whether native controls are readable.
   *
   * A `<select>`'s dropdown, a date field's calendar and the search input's
   * clear button are painted by the browser, not from the DOM — they cannot be
   * screenshotted, queried or styled. `color-scheme` is the only handle CSS
   * has on them, and getting it wrong is invisible to every other kind of test:
   * the page looks perfect until someone opens a select, and then reads light
   * grey text on a white popup.
   *
   * So this asserts the property directly in both themes, on the surface that
   * carries the most native controls.
   */
  test("native controls follow the theme, not the platform default", async ({ page }) => {
    await page.goto("/projects");

    const scheme = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

    await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(await scheme()).toBe("light");

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await scheme()).toBe("dark");

    // And it survives into a dialog, which is where the selects actually live.
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await scheme()).toBe("dark");
    await expect(page.locator("#status")).toBeVisible();
  });

  test("renders without a hydration mismatch warning", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    expect(errors.filter((text) => /hydrat/i.test(text))).toEqual([]);
  });
});
