/**
 * One person with an account in each app, signed in to both in one browser
 * context, the way someone using the integration is.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { signInToDoqtri, signInToQdit, type DoqtriUser, type QditUser } from "./accounts";
import { env } from "./env";
import { connectThroughDoqtri, dropDoqtriConnection } from "./world";

export type Pair = { context: BrowserContext; page: Page; qdit: QditUser; doqtri: DoqtriUser };

/** `label` picks the person; the same label is the same two accounts on every run. */
export async function openPair(browser: Browser, label = "owner"): Promise<Pair> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const qdit = await signInToQdit(context, label);
  const doqtri = await signInToDoqtri(context, label);
  const page = await context.newPage();
  return { context, page, qdit, doqtri };
}

/** doqtri's Connected apps panel. */
export async function doqtriAppsPanel(page: Page) {
  await page.goto(`${env().doqtriOrigin}/vault/profile?tab=apps`);
  return page.getByTestId("qdit-status");
}

/**
 * Revokes doqtri in qdit's Settings > Authorized apps, as the user would.
 * Returns false when doqtri is not listed (no live grant).
 */
export async function revokeInQdit(page: Page): Promise<boolean> {
  const e = env();
  await page.goto(`${e.qditOrigin}/settings`);
  const doqtriHost = new URL(e.doqtriOrigin).host;
  const row = page.locator("li").filter({ hasText: doqtriHost }).filter({ has: page.getByRole("button", { name: "Revoke" }) });
  if ((await row.count()) === 0) return false;
  await row.first().getByRole("button", { name: "Revoke" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText(/disconnected$/).first()).toBeVisible();
  await expect(dialog).toBeHidden();
  return true;
}

/**
 * Starts the person disconnected on both sides: no grant in qdit, no stored
 * connection in doqtri. A run interrupted mid-spec leaves either behind.
 */
export async function startDisconnected(pair: Pair): Promise<void> {
  // One row per grant; a crashed run can leave more than one. Bounded, so a
  // revoke that does not take cannot loop forever.
  for (let i = 0; i < 5 && (await revokeInQdit(pair.page)); i++);
  expect(await revokeInQdit(pair.page), "doqtri is still listed in qdit's Authorized apps").toBe(false);
  await dropDoqtriConnection(pair.doqtri.id);
}

/** Connected through doqtri's own flow, and doqtri says so. */
export async function connect(pair: Pair): Promise<void> {
  await connectThroughDoqtri(pair.page, "approve");
  await expect(pair.page.getByTestId("qdit-outcome")).toContainText(/connected/i);
  await expect(await doqtriAppsPanel(pair.page)).toHaveText("Connected");
}
