import { expect, type Page } from "@playwright/test";

/**
 * Picks an option from a `SelectField`.
 *
 * `page.selectOption()` drives a native `<select>` and these are not one any
 * more — the form's select is built on Radix so its list is real DOM that can
 * be themed and, unlike a browser-painted popup, actually asserted. The trade
 * is that choosing means clicking, which is what this wraps.
 *
 * Two details that will bite anyone writing this inline:
 *
 * Options are matched by their **visible label**, not the underlying value.
 * There is no `value` attribute to select on once the list is real elements, so
 * `"Ready for Mainnet"` rather than `"ready_for_mainnet"`.
 *
 * The list is located by CSS, not `getByRole`. Radix portals the content to
 * `<body>`, and an open dialog marks everything outside itself `aria-hidden` —
 * so a role query cannot see the very options the dialog just opened.
 */
export async function choose(page: Page, triggerId: string, label: string): Promise<void> {
  await page.locator(`#${triggerId}`).click();

  // Anchored so "Testnet" cannot match "Testnet" inside a longer label, and so
  // a substring like "None" cannot land on the wrong row.
  const option = page
    .locator('[role="option"]')
    .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });

  await expect(option).toHaveCount(1);
  await option.click();

  // Radix closes on select; waiting for that keeps the next click from landing
  // on the overlay this one left behind.
  await expect(option).toBeHidden();
}
