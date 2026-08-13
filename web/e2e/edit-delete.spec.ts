import { expect, test, type Page } from "@playwright/test";

import { choose } from "./select";
import { MEMBERS, OUTSIDER, PROJECT } from "./seed";

/**
 * The edit and delete path, plus the two writes that had no coverage at all:
 * deployment logging and the milestone approval flow.
 *
 * Everything created here is prefixed `e2e <noun> ` and removed by
 * `cleanup.teardown.ts`, so a failure part-way through still leaves no residue.
 *
 * Serial, like the other write specs: these mutate shared state, and a parallel
 * worker reading a count mid-write would flake.
 */
test.describe.configure({ mode: "serial" });

const unique = (noun: string) =>
  `e2e ${noun} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Opens a row's overflow menu. The button only appears on hover or focus. */
async function openRowMenu(page: Page, rowText: string, noun: string) {
  const row = page.locator('[data-slot="list-row"], article').filter({ hasText: rowText });
  await row.first().hover();
  await row.first().getByRole("button", { name: `Actions for this ${noun}` }).click();
}

test.describe("editing a task", () => {
  test("renames a task, and the new title is what persists", async ({ page }) => {
    const title = unique("task");
    const renamed = `${title} renamed`;

    // Create one to edit rather than mutating a seeded row the read-only
    // specs assert against.
    await page.goto(`/projects/${PROJECT.slug}/board`);
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

    await openRowMenu(page, title, "task");
    await page.getByRole("menuitem", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The form opens populated — an edit dialog that starts blank would wipe
    // every field the user did not retype.
    await expect(dialog.getByLabel("Title")).toHaveValue(title);

    await dialog.getByLabel("Title").fill(renamed);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect(page.getByText(renamed)).toBeVisible();

    // Survives a reload: the change reached Postgres, not just the client.
    await page.reload();
    await expect(page.getByText(renamed)).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  });

  test("deleting asks first, and the task is gone afterwards", async ({ page }) => {
    const title = unique("task");

    await page.goto(`/projects/${PROJECT.slug}/board`);

    const todoCount = page.locator(
      '[data-slot="board-column"][data-status="todo"] [data-slot="board-count"]',
    );

    /**
     * Sampled *before* creating, and every later check is a retrying
     * assertion rather than a bare read.
     *
     * The dialog closes when the action returns, but `revalidatePath` re-renders
     * the tree afterwards, so reading the count the instant the dialog hides can
     * catch the pre-create value. That made `before` one too low, and the final
     * `before - 1` then failed against a count that was actually correct.
     */
    const before = Number(await todoCount.innerText());

    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
    await expect(todoCount).toHaveText(String(before + 1));

    await openRowMenu(page, title, "task");
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // Confirmation is required — the card is still there while it is open.
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(title);
    // A CSS locator, not getByRole: the modal marks the rest of the page
    // aria-hidden, so role-based queries cannot see the card behind it. Scoped
    // to the card either way, because the confirmation quotes the title too.
    await expect(page.locator("article").filter({ hasText: title })).toBeVisible();

    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden({ timeout: 20_000 });

    await expect(page.locator("article").filter({ hasText: title })).toHaveCount(0);
    await expect(todoCount).toHaveText(String(before));
  });

  test("cancelling the confirmation leaves the task alone", async ({ page }) => {
    const title = unique("task");

    await page.goto(`/projects/${PROJECT.slug}/board`);
    await page.getByRole("button", { name: "New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

    await openRowMenu(page, title, "task");
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("alertdialog")).toBeHidden();
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();
  });
});

test.describe("the project slug is fixed after creation", () => {
  test("the edit form shows the slug but will not let it change", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}`);

    await page.getByRole("button", { name: "Actions for this project" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Present so it can be read, disabled because it is not a decision
    // available here — every URL for this project contains it.
    const slug = dialog.getByLabel("URL slug");
    await expect(slug).toHaveValue(PROJECT.slug);
    await expect(slug).toBeDisabled();
  });
});

test.describe("milestone approval follows the contract's state machine", () => {
  test("a proposed milestone offers submit, and nothing else", async ({ page }) => {
    const title = unique("milestone");

    await page.goto(`/projects/${PROJECT.slug}/milestones`);
    await page.getByRole("button", { name: "New milestone" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create milestone" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

    const row = page.locator('[data-slot="list-row"]').filter({ hasText: title });
    await row.getByRole("button", { name: /^Status: Proposed/ }).click();

    // Proposed -> Submitted is the only legal move. Approve and Reject are not
    // offered, because the contract only accepts them from Submitted.
    await expect(page.getByRole("menuitem", { name: "Submit for approval" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Reject" })).toHaveCount(0);

    await page.getByRole("menuitem", { name: "Submit for approval" }).click();
    await expect(
      page.locator('[data-slot="list-row"]').filter({ hasText: title }),
    ).toContainText("Submitted", { timeout: 20_000 });
  });

  test("the milestone edit form has no status field", async ({ page }) => {
    const title = unique("milestone");

    await page.goto(`/projects/${PROJECT.slug}/milestones`);
    await page.getByRole("button", { name: "New milestone" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create milestone" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });

    await openRowMenu(page, title, "milestone");
    await page.getByRole("menuitem", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Title")).toHaveValue(title);
    // Status belongs to the approval flow, which enforces the contract's
    // transitions. A select here would be a second, permissive path.
    await expect(dialog.locator("#m-status")).toHaveCount(0);
  });
});

test.describe("recording a deployment", () => {
  test("appends to the history and becomes the current state", async ({ page }) => {
    const notes = unique("deployment");

    await page.goto(`/projects/${PROJECT.slug}/deployments`);
    await page.getByRole("button", { name: "Record deployment" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Release notes").fill(notes);
    await choose(page, "d-status", "Ready for Mainnet");
    await choose(page, "d-network", "Testnet");
    await dialog.getByRole("button", { name: "Record deployment" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect(page.getByText(notes)).toBeVisible();

    // Newest row is the current state, so the header badge follows it.
    await expect(page.getByText("Ready for Mainnet").first()).toBeVisible();
  });

  test("a status past Not Started requires a network", async ({ page }) => {
    await page.goto(`/projects/${PROJECT.slug}/deployments`);
    await page.getByRole("button", { name: "Record deployment" }).click();

    const dialog = page.getByRole("dialog");
    await choose(page, "d-status", "Mainnet Live");
    await choose(page, "d-network", "None");
    await dialog.getByRole("button", { name: "Record deployment" }).click();

    // Reported inline against the field, not as a Postgres 23514 after the
    // insert is attempted. The dialog stays open with the input intact.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Pick the network this was deployed to.")).toBeVisible();
  });
});

test.describe("profile", () => {
  /**
   * This used to assert that a malformed address was rejected before saving.
   * There is nothing left to reject: the field is gone, because an address
   * that is typed is claimed and an address that arrives through a signed
   * challenge is proved, and only the second kind may reach the column.
   *
   * So the assertion is now that the box does not exist — which is the stronger
   * statement, and the one that fails if somebody puts it back.
   */
  test("offers no way to type a wallet address", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit profile" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Display name")).toBeVisible();
    await expect(dialog.getByLabel("Wallet address")).toHaveCount(0);
    await expect(dialog.getByPlaceholder("G…")).toHaveCount(0);
  });

  test("offers to bind a wallet, and never a box to type one into", async ({ page }) => {
    await page.goto("/settings");

    /*
      The e2e account predates the wallet flow: it signed up with an email and
      has no address on its profile. That is the case this asserts — the one
      remaining way an address can be attached, and the only account shape that
      can still do it.

      The opposite state, an account whose address is bound and permanent, is
      asserted in `wallet-auth.spec.ts` against an account that registers one
      during the run. Neither test can cover both, because which branch renders
      is a property of the account, not of the page.
    */
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await expect(page.getByPlaceholder("G…")).toHaveCount(0);
  });
});

/**
 * Inviting by identifier — the only path that can reach someone outside the
 * caller's existing circle.
 *
 * One field takes a username, an email address or a wallet address, and the
 * server decides which it was given. These specs add the same person three
 * ways, because "it does not matter which one you are holding" is the whole
 * claim the single field makes.
 *
 * Runs against a project this spec creates rather than the seeded one, for two
 * reasons. Adding a member to the seeded project would move the roster
 * `members.spec.ts` asserts, and nothing in `cleanup.teardown.ts` removes a
 * membership row on its own. Deleting a project cascades to its members, and
 * `e2e project …` is already one of that teardown's targets, so the whole thing
 * cleans itself up.
 */
test.describe("adding a member", () => {
  /** The dialog's one identifier field. */
  const FIELD = "Username, email or wallet address";
  /** `unique()` yields only lowercase and digits, so the dialog's slug is this. */
  const slugFor = (name: string) => name.replace(/[^a-z0-9]+/g, "-");

  async function createProject(page: Page, name: string) {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
  }

  test("adds someone RLS hides from the picker entirely", async ({ page }) => {
    const name = unique("project");
    await createProject(page, name);

    await page.goto(`/projects/${slugFor(name)}/members`);
    // The creator is the only member, and the owner row is the trigger's own.
    await expect(page.getByText(MEMBERS.owner.name)).toBeVisible();
    await expect(page.getByText(OUTSIDER.name)).toHaveCount(0);

    await page.getByRole("button", { name: "Add member" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(FIELD).fill(OUTSIDER.email);
    await choose(page, "m-role", "Member");
    await dialog.getByRole("button", { name: "Add member" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    // Resolved server-side: nothing the browser could query knew her user id.
    await expect(page.getByText(OUTSIDER.name)).toBeVisible();

    // And it stuck, rather than only appearing in an optimistic render.
    await page.reload();
    await expect(page.getByText(OUTSIDER.name)).toBeVisible();
  });

  test("the same person, by username", async ({ page }) => {
    const name = unique("project");
    await createProject(page, name);

    await page.goto(`/projects/${slugFor(name)}/members`);
    await page.getByRole("button", { name: "Add member" }).click();

    const dialog = page.getByRole("dialog");
    // Typed the way a person capitalises a name. The function lowercases before
    // it looks, because the column only ever holds lowercase.
    await dialog.getByLabel(FIELD).fill(OUTSIDER.username.toUpperCase());
    await dialog.getByRole("button", { name: "Add member" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect(page.getByText(OUTSIDER.name)).toBeVisible();
  });

  test("the same person, by wallet address", async ({ page }) => {
    const name = unique("project");
    await createProject(page, name);

    await page.goto(`/projects/${slugFor(name)}/members`);
    await page.getByRole("button", { name: "Add member" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(FIELD).fill(OUTSIDER.wallet);
    await dialog.getByRole("button", { name: "Add member" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect(page.getByText(OUTSIDER.name)).toBeVisible();
  });

  test("a username matching no account is reported on the field", async ({ page }) => {
    const name = unique("project");
    await createProject(page, name);

    await page.goto(`/projects/${slugFor(name)}/members`);
    await page.getByRole("button", { name: "Add member" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(FIELD).fill(`nobody_${Date.now()}`);
    await dialog.getByRole("button", { name: "Add member" }).click();

    // Names the kind it understood the input to be. "No account matches that"
    // would leave the admin wondering whether it read a username at all.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/No qdit account uses that username/)).toBeVisible();
  });

  test("a mistyped wallet address is reported as an address", async ({ page }) => {
    const name = unique("project");
    await createProject(page, name);

    await page.goto(`/projects/${slugFor(name)}/members`);
    await page.getByRole("button", { name: "Add member" }).click();

    const dialog = page.getByRole("dialog");
    // 56 characters starting with G, with an illegal base32 digit — a broken
    // address, not a username that is far too long.
    await dialog.getByLabel(FIELD).fill(`G1${OUTSIDER.wallet.slice(2)}`);
    await dialog.getByRole("button", { name: "Add member" }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/start with G and are 56 characters/)).toBeVisible();
  });

  test("an address matching no account is reported on the field", async ({ page }) => {
    const name = unique("project");
    await createProject(page, name);

    await page.goto(`/projects/${slugFor(name)}/members`);
    await page.getByRole("button", { name: "Add member" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(FIELD).fill(`nobody-${Date.now()}@qdit.test`);
    await dialog.getByRole("button", { name: "Add member" }).click();

    // Inline on the field, not a toast: the email is the thing to correct, and
    // the dialog stays open holding everything else the user typed.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/No qdit account uses that email/)).toBeVisible();
  });

  test("adding the same person twice says so", async ({ page }) => {
    const name = unique("project");
    await createProject(page, name);
    await page.goto(`/projects/${slugFor(name)}/members`);

    for (const attempt of [1, 2]) {
      await page.getByRole("button", { name: "Add member" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(FIELD).fill(OUTSIDER.email);
      await dialog.getByRole("button", { name: "Add member" }).click();

      if (attempt === 1) {
        await expect(dialog).toBeHidden({ timeout: 20_000 });
      } else {
        // The composite primary key rejects it; the message has to say which of
        // the several ways this can fail actually happened.
        await expect(dialog.getByText(/already a member/)).toBeVisible();
        await page.keyboard.press("Escape");
      }
    }
  });
});
