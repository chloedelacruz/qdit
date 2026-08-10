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
   * The property that decides whether browser-painted controls are readable.
   *
   * A date field's calendar, the search input's clear button and the
   * scrollbars are drawn by the browser, not built from the DOM — they cannot
   * be screenshotted, queried or styled, so `color-scheme` is the only handle
   * CSS has on them and a regression is invisible to every other kind of test.
   *
   * The dropdowns used to be in that set and are not any more: `SelectField`
   * builds its list from real elements precisely so it can be styled and
   * asserted, which the test below this one does.
   */
  test("browser-painted controls follow the theme, not the platform", async ({ page }) => {
    await page.goto("/projects");

    const scheme = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

    await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(await scheme()).toBe("light");

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(await scheme()).toBe("dark");
  });

  /**
   * The bug this replaced a native `<select>` to fix: options rendered as
   * light grey on a white popup, unreadable and unreachable from CSS.
   *
   * Asserting the *painted* colours rather than class names, because the
   * failure was precisely that the markup looked right. Contrast is computed
   * from the option's own text and the surface behind it, so a future theme
   * change that reintroduces a pale-on-pale list fails here.
   */
  test("dropdown options are readable in dark mode", async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.getByRole("button", { name: "New project" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.locator("#status").click();

    const option = page.locator('[role="option"]').filter({ hasText: /^Paused$/ });
    await expect(option).toBeVisible();

    /**
     * Rasterised through a canvas, not parsed. Chromium reports computed
     * colours as `lab(...)` — the same reason the brand test above paints
     * rather than compares strings — so reading digits out of the string
     * yields numbers that are not sRGB at all.
     */
    const [text, surface] = await option.evaluate((el) => {
      const toRgb = (colour: string) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b] as [number, number, number];
      };

      // Walk up for the first ancestor that actually paints a background.
      let node: HTMLElement | null = el as HTMLElement;
      let background = "rgb(255, 255, 255)";
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        if (value && !/rgba\(0, 0, 0, 0\)|transparent/.test(value)) {
          background = value;
          break;
        }
        node = node.parentElement;
      }

      return [toRgb(getComputedStyle(el).color), toRgb(background)];
    });

    const luminance = ([r, g, b]: [number, number, number]) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const [lighter, darker] = [luminance(text), luminance(surface)].sort((a, b) => b - a);
    const contrast = (lighter + 0.05) / (darker + 0.05);

    // WCAG AA for body text. The bug measured near 1:1.
    expect(contrast, `option rgb(${text}) on rgb(${surface})`).toBeGreaterThan(4.5);
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
