import { devices, expect, test, type Page } from "@playwright/test";

import { PROJECT } from "./seed";
import { NO_SERVICE, rest, service, tag } from "./service";

/**
 * What a milestone says before it can be anchored or certified (QDIT-34).
 *
 * These need a milestone with no anchors, on a project not yet registered on
 * chain. On production the seeded project is registered and its seeded
 * milestones get anchored by hand, so they build their own (QDIT-38, QDIT-39).
 *
 * Writes a project and a milestone, named with the `e2e` prefixes the teardown
 * removes, so this runs in `publishing`, after the specs that assert exact
 * counts. Skipped where anchoring is off, because then there is nothing to gate.
 */
test.skip(
  !process.env.NEXT_PUBLIC_MILESTONE_PROOF_CONTRACT_ID,
  "Anchoring is not configured for this deployment.",
);

test.describe.configure({ mode: "serial" });

const svc = service();
let fixture: { projectId: string; slug: string; milestoneId: string } | null = null;

test.beforeAll(async () => {
  if (!svc) return;

  // The signed-in account owns the seeded project, so it owns this one too.
  const [seeded] = await rest<{ owner_id: string }[]>(
    svc,
    `projects?id=eq.${PROJECT.id}&select=owner_id`,
  );
  const id = tag();
  const slug = `e2e-project-${id}`;
  const [project] = await rest<{ id: string }[]>(svc, "projects", {
    method: "POST",
    body: { owner_id: seeded.owner_id, name: `e2e project ${id}`, slug, status: "active" },
  });
  const [milestone] = await rest<{ id: string }[]>(svc, "milestones", {
    method: "POST",
    body: { project_id: project.id, title: `e2e milestone ${id}`, status: "proposed" },
  });
  fixture = { projectId: project.id, slug, milestoneId: milestone.id };
});

test.afterAll(async () => {
  if (!svc || !fixture) return;
  await rest(svc, `projects?id=eq.${fixture.projectId}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
});

test.beforeEach(async ({ page }) => {
  test.skip(!svc, NO_SERVICE);
  await page.goto(`/projects/${fixture!.slug}/milestones/${fixture!.milestoneId}`);
});

/** See `section` in milestone-page.spec.ts for why it matches this way. */
const history = (page: Page) => page.getByRole("region", { name: /^History(?![a-z])/ });

test("a disabled Certificate says why on keyboard focus", async ({ page }) => {
  const gate = history(page).locator('[data-slot="disabled-reason"]', { hasText: "Certificate" });
  await expect(gate).toHaveAttribute("aria-disabled", "true");
  await expect(gate.getByRole("button", { name: "Certificate" })).toBeDisabled();
  // The reason is in the DOM for a screen reader, not only in the tooltip.
  await expect(gate).toContainText(/anchor/i);

  // Reached with Tab, straight after the heading's ⓘ: a disabled <button>
  // takes no focus, and the wrapper is what keeps the reason reachable.
  await page.getByRole("button", { name: "About the history" }).focus();
  await page.keyboard.press("Tab");
  await expect(gate).toBeFocused();

  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toContainText(/anchor/i);
});

test("anchoring an unregistered project's milestone says why instead of opening", async ({
  page,
}) => {
  await expect(page.locator(`a[href="/projects/${fixture!.slug}#chain"]`).first()).toBeVisible();

  await page.getByRole("button", { name: "Actions for this milestone" }).first().click();
  const item = page.getByRole("menuitem", { name: /^Anchor proof on chain/ });

  await expect(item).toHaveAttribute("aria-disabled", "true");
  await item.hover();
  await expect(page.getByRole("tooltip")).toContainText("Register this project on chain first.");

  // Choosing it opens nothing. Forced, because Playwright waits for an
  // aria-disabled element to become enabled, and this one never does.
  await item.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test.describe("under a finger", () => {
  // Pixel 7, as in the `mobile` project, spelled out because a describe block
  // can't set the `defaultBrowserType` that `devices` also carries.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  /**
   * The reason a control is disabled must reach a phone too: Radix tooltips
   * open on hover and focus only, and `Hint` adds the tap.
   */
  test("tapping a disabled Certificate shows the reason", async ({ page }) => {
    const gate = history(page).locator('[data-slot="disabled-reason"]', { hasText: "Certificate" });
    // Forced, because Playwright waits for an aria-disabled element to become
    // enabled, and this one never does.
    await gate.tap({ force: true });

    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/anchor/i);
  });
});
