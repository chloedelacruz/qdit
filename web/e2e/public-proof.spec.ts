import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { PROJECT } from "./seed";
import { NO_SERVICE, rest, service, tag, type Service } from "./service";

/**
 * `/p/[slug]/[milestone]`, as the person it exists for sees it: someone with no
 * account, sent a link.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SPEC BUILDS ITS OWN PROJECTS
 * ---------------------------------------------------------------------------
 * A milestone is public only when its project has `public_proofs` on, and the
 * seeded project's setting is the owner's to change, not this suite's. So the
 * fixture is two projects of its own, made through the service role and owned
 * by the seeded project's owner:
 *
 *   - one published, with one milestone, and that milestone linked to a doqtri
 *     heading so the four-step proof chain renders;
 *   - one unpublished, with one milestone, to prove the page answers 404 for it.
 *
 * Both are named `e2e project …`, so `cleanup.teardown.ts` removes them even if
 * this run crashes, and `afterAll` removes them straight away otherwise. The
 * milestones go with their projects (on delete cascade).
 *
 * The doqtri link is a database row, not a real doqtri document: what is
 * asserted is that the page lays out the four steps and gives each one of its
 * four states. Whether a real doqtri plan reads Done on all four is the
 * cross-repo suite's question (QDIT-1), not this one.
 *
 * Runs in the `publishing` project, after `edits`: it adds a milestone to the
 * signed-in account's workspace, and `lists.spec.ts` counts those exactly.
 */

type Fixture = {
  published: { slug: string; milestoneId: string; milestoneTitle: string; name: string };
  unpublished: { slug: string; milestoneId: string };
  projectIds: string[];
};

let svc: Service | null = null;
let fixture: Fixture | null = null;

async function makeProject(
  s: Service,
  owner: string,
  name: string,
  slug: string,
  publicProofs: boolean,
): Promise<string> {
  const [row] = await rest<{ id: string }[]>(s, "projects", {
    method: "POST",
    body: { owner_id: owner, name, slug, status: "active", public_proofs: publicProofs },
  });
  return row.id;
}

async function makeMilestone(s: Service, projectId: string, title: string): Promise<string> {
  const [row] = await rest<{ id: string }[]>(s, "milestones", {
    method: "POST",
    body: { project_id: projectId, title },
  });
  return row.id;
}

test.beforeAll(async () => {
  svc = service();
  if (!svc) return;

  const [{ owner_id: owner }] = await rest<{ owner_id: string }[]>(
    svc,
    `projects?id=eq.${PROJECT.id}&select=owner_id`,
  );

  const t = tag();
  const name = `e2e project public proof ${t}`;
  const publishedId = await makeProject(svc, owner, name, `e2e-public-${t}`, true);
  const unpublishedId = await makeProject(
    svc,
    owner,
    `e2e project private proof ${t}`,
    `e2e-private-${t}`,
    false,
  );

  const milestoneTitle = `e2e milestone public ${t}`;
  const milestoneId = await makeMilestone(svc, publishedId, milestoneTitle);
  const hiddenId = await makeMilestone(svc, unpublishedId, `e2e milestone private ${t}`);

  // node_label must equal the milestone title (D-12); the trigger checks it.
  await rest(svc, "milestone_external_links", {
    method: "POST",
    body: {
      milestone_id: milestoneId,
      project_id: publishedId,
      doc_id: randomUUID(),
      node_id: `e2e-node-${t}`,
      node_label: milestoneTitle,
      doc_version: 1,
    },
  });

  fixture = {
    published: { slug: `e2e-public-${t}`, milestoneId, milestoneTitle, name },
    unpublished: { slug: `e2e-private-${t}`, milestoneId: hiddenId },
    projectIds: [publishedId, unpublishedId],
  };
});

test.afterAll(async () => {
  if (!svc || !fixture) return;
  await rest(svc, `projects?id=in.(${fixture.projectIds.join(",")})`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
});

test.beforeEach(() => {
  test.skip(!svc, NO_SERVICE);
});

test.describe("public proof page, signed out", () => {
  // The project this runs in is signed in (oauth.spec.ts needs it); this
  // file's whole subject is the visitor who is not.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a published milestone opens with no account and states its network", async ({
    page,
  }) => {
    const { slug, milestoneId, milestoneTitle, name } = fixture!.published;
    const response = await page.goto(`/p/${slug}/${milestoneId}`);

    expect(response?.status()).toBe(200);
    // Not bounced to sign-in: the page is the destination.
    await expect(page).toHaveURL(new RegExp(`/p/${slug}/${milestoneId}$`));

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(milestoneTitle);
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    // Named, not inferred from a hash: Testnet is the network this
    // deployment runs on, and the label says so in the header.
    const network = page.getByRole("banner").getByText("Testnet", { exact: true });
    await expect(network).toBeVisible();
    await expect(network).toHaveAttribute("title", /test network — not the public ledger/);

    // Nothing anchored yet, and the page says so rather than showing a blank.
    await expect(
      page.getByText("This milestone has not been anchored yet", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "What the ledger proves" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What it does not" })).toBeVisible();
    await expect(page.getByText("Nothing on this page requires an account to verify.")).toBeVisible();
  });

  test("the proof chain has four steps, each in one of its four states", async ({ page }) => {
    const { slug, milestoneId } = fixture!.published;
    await page.goto(`/p/${slug}/${milestoneId}`);

    const chain = page.locator('[data-slot="proof-chain"]');
    await expect(chain).toBeVisible();

    const steps = chain.locator("ol > li");
    await expect(steps).toHaveCount(4);

    // D-78: the same four words on both apps' pages, and no fifth.
    const states = await chain.locator('[data-slot="step-state"]').allInnerTexts();
    expect(states).toHaveLength(4);
    for (const state of states) {
      expect(["Done", "Pending", "Does not match", "Could not check"]).toContain(state.trim());
    }
  });

  test("a milestone in an unpublished project is not found", async ({ page }) => {
    const { slug, milestoneId } = fixture!.unpublished;
    const response = await page.goto(`/p/${slug}/${milestoneId}`);

    expect(response?.status()).toBe(404);
    await expect(page.getByText(fixture!.published.milestoneTitle)).toHaveCount(0);
  });

  test("an unknown milestone in a published project is not found", async ({ page }) => {
    const response = await page.goto(`/p/${fixture!.published.slug}/${randomUUID()}`);
    expect(response?.status()).toBe(404);
  });
});
