import { readFile } from "node:fs/promises";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import {
  completeGradingSynthetically,
  createFixture,
  hackathonsAvailable,
  PNG_FIXTURE,
  rpcAs,
  storagePaths,
  sweepE2eHackathons,
  SYNTHETIC_TOTAL,
  tokenFor,
  type Account,
  type Fixture,
} from "./hackathon-fixture";
import { NO_SERVICE, rest, service, tag } from "./service";

/**
 * The hackathon portal end to end (WP-4.7, QDIT-49; D-115, D-116, D-119).
 *
 * One event, in order: an admin adds a judge; a team's project admin submits
 * with a mindmap image and resubmits; the closed window refuses; a late pass
 * lets the team in again; the team sees "Received" and nothing about grades;
 * the admin console stays sealed; grading jobs are settled with synthetic
 * runs through the service-role RPCs (no model is called); the admin
 * releases; only the admin sees the leaderboard; the judge scores the
 * finalist; the CSV matches the screen; and judge and team get the 404s and
 * "sealed" answers the design promises.
 *
 * Everything is built for this run: five accounts (`e2e-hackathon-<run>-…
 * @example.invalid`, random passwords that live only in memory), a
 * hackathon `e2e-<run>` and a project `e2e project hackathon-<run>`. The
 * afterAll sweep deletes every `e2e-` hackathon with its Storage objects,
 * those projects and accounts, and fails if any remain; cleanup.teardown.ts
 * runs the same sweep for a crashed run. The signed-in `E2E_EMAIL` account is
 * not used, so the counts the read-only specs assert are untouched.
 *
 * Its own project in playwright.config.ts (`hackathon`), after `publishing`.
 * Skipped, with the reason, where the hackathon migration is not applied.
 */

test.describe.configure({ mode: "serial" });

const svc = service();
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

let fx: Fixture;
let skipReason: string | null = null;
const contexts = new Map<string, { context: BrowserContext; page: Page }>();
const versions: string[] = [];

const teamName = () => `e2e team ${fx.runId}`;
const teamNameV2 = () => `e2e team ${fx.runId} v2`;
// QDIT-63: any link the database accepts; nobody opens it in the run.
const SLIDES_URL = "https://docs.google.com/presentation/d/e2e-qdit-deck/edit?usp=sharing";
const hackathonUrl = () => `/hackathons/${fx.slug}`;

/** Words the participant page must never show (D-116). */
const GRADE_WORDS = /\b(score[sd]?|grade[sd]?|graded|grading|rank(ed|ing)?|eligib\w*|finalists?|leaderboard|AI review|\/\s?100|points?)\b/i;

async function signIn(browser: Browser, account: Account): Promise<Page> {
  const existing = contexts.get(account.email);
  if (existing) return existing.page;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  contexts.set(account.email, { context, page });
  return page;
}

async function expectHackathonNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText("Hackathon not found")).toBeVisible();
}

async function bodyText(page: Page): Promise<string> {
  return page.locator("main").innerText();
}

/** `YYYY-MM-DDTHH:mm` in Asia/Manila (UTC+8, no daylight saving) for a datetime-local input. */
function manilaLocal(ms: number): string {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(0, 16);
}

test.beforeAll(async () => {
  if (!svc || !publishableKey) {
    skipReason = NO_SERVICE;
    return;
  }
  if (!(await hackathonsAvailable(svc))) {
    skipReason = "The hackathon migration (20261110100000_hackathons.sql) is not applied to this project.";
    return;
  }
  fx = await createFixture(svc, tag());
});

test.beforeEach(() => {
  test.skip(skipReason !== null, skipReason ?? "");
});

test.afterAll(async () => {
  for (const { context } of contexts.values()) await context.close().catch(() => undefined);
  if (!svc || skipReason) return;
  const removed = await sweepE2eHackathons(svc);
  console.log(
    `[hackathon] removed ${removed.hackathons} e2e hackathon(s), ${removed.objects} mindmap object(s), ${removed.accounts} account(s).`,
  );
  if (fx) expect(await storagePaths(svc, fx.hackathonId)).toEqual([]);
});

test("the admin adds a judge by username", async ({ browser }) => {
  const page = await signIn(browser, fx.admin);
  await page.goto(`${hackathonUrl()}/admin`);
  await expect(page.getByRole("heading", { name: "Admin", level: 1 })).toBeVisible();

  await page.getByLabel("Username").fill(fx.judge.username);
  // Role defaults to Judge.
  await page.getByRole("button", { name: "Add or change" }).click();
  await expect(page.getByText("Staff updated.")).toBeVisible();

  const staff = page.getByRole("list", { name: "Staff" });
  const row = staff.locator("li", { hasText: `@${fx.judge.username}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Judge");
});

test("the team's project admin submits with a mindmap image, then resubmits", async ({ browser }) => {
  const page = await signIn(browser, fx.lead);
  await page.goto(hackathonUrl());
  await expect(page.getByText("No submission yet.")).toBeVisible();

  await page.getByRole("button", { name: "Add submission to hackathon", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Team name").fill(teamName());
  for (const person of [fx.lead, ...fx.members]) {
    await dialog.getByRole("checkbox", { name: new RegExp(person.name) }).click();
  }
  await expect(dialog.getByText("3 selected")).toBeVisible();

  await dialog.locator('input[type="file"]').first().setInputFiles({
    name: "global-mindmap.png",
    mimeType: "image/png",
    buffer: PNG_FIXTURE,
  });
  // Exact: "Not attached." contains the same words.
  await expect(dialog.getByText("Attached.", { exact: true })).toHaveCount(1);

  // The Slides link is required (QDIT-63): refused while empty, then filled.
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(dialog.getByText("Add the link to your slides.")).toBeVisible();
  await dialog.getByLabel("Slides link").fill(SLIDES_URL);

  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Submission received.")).toBeVisible();
  await expect(dialog).toBeHidden();

  const entry = page.locator("article", { hasText: teamName() });
  await expect(entry.getByText("Received", { exact: true })).toBeVisible();
  await expect(entry).toContainText("1 version");
  await expect(entry.getByRole("img", { name: "Global mindmap" })).toBeVisible();
  await expect(entry.getByRole("link", { name: SLIDES_URL })).toHaveAttribute("href", SLIDES_URL);

  // The image went to the private bucket under this hackathon's prefix.
  expect(await storagePaths(svc!, fx.hackathonId)).toHaveLength(1);

  // Resubmit: the saved team and image come back, the new name is kept.
  await page.getByRole("button", { name: "Update submission", exact: true }).click();
  await expect(dialog.getByLabel("Team name")).toHaveValue(teamName());
  await expect(dialog.getByLabel("Slides link")).toHaveValue(SLIDES_URL);
  await dialog.getByLabel("Team name").fill(teamNameV2());
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Submission received.").first()).toBeVisible();

  const updated = page.locator("article", { hasText: teamNameV2() });
  await expect(updated).toContainText("2 versions");

  const [submission] = await rest<{ id: string }[]>(
    svc!,
    `hackathon_submissions?hackathon_id=eq.${fx.hackathonId}&select=id`,
  );
  const rows = await rest<{ id: string; version_no: number }[]>(
    svc!,
    `hackathon_submission_versions?submission_id=eq.${submission.id}&select=id,version_no&order=version_no`,
  );
  expect(rows.map((r) => r.version_no)).toEqual([1, 2]);
  versions.push(...rows.map((r) => r.id));
});

test("the participant page shows Received and no grade words", async ({ browser }) => {
  const page = await signIn(browser, fx.lead);
  await page.goto(hackathonUrl());
  await expect(page.locator("article", { hasText: teamNameV2() }).getByText("Received", { exact: true })).toBeVisible();
  expect(await bodyText(page)).not.toMatch(GRADE_WORDS);
});

test("the admin console is sealed before release", async ({ browser }) => {
  const page = await signIn(browser, fx.admin);
  await page.goto(`${hackathonUrl()}/admin`);
  await expect(page.getByText("Sealed", { exact: true })).toBeVisible();
  await expect(page.getByText("Grades are sealed until release.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toHaveCount(0);
  await expect(page.getByText("AI /100")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Export results" })).toHaveCount(0);
  // Release waits for the close.
  await expect(page.getByRole("button", { name: "Release grades", exact: true })).toBeDisabled();

  const csv = await page.request.get(`/api/hackathons/${fx.slug}/export`);
  expect(csv.status()).toBe(409);

  // Export submissions is not score-derived, so it works before release (QDIT-63).
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export submissions" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${fx.slug}-submissions.csv`);
  const [header, ...lines] = (await readFile((await download.path())!, "utf8")).trimEnd().split("\r\n");
  expect(header).toBe("Team name,Slides link,Global mindmap,Note map 1,Note map 2");
  expect(lines).toHaveLength(1);
  const [team, slides, globalMap, note1, note2] = lines[0].split(",");
  expect([team, slides, note1, note2]).toEqual([teamNameV2(), SLIDES_URL, "", ""]);
  expect(globalMap).toMatch(/^https:\/\/.+\/storage\/v1\/object\/sign\/hackathon-mindmaps\//);

  // The database refuses the leaderboard to the admin too, before release.
  const token = await tokenFor(svc!, publishableKey, fx.admin);
  const board = await rpcAs(svc!, publishableKey, token, "hackathon_leaderboard", { p_hackathon_id: fx.hackathonId });
  expect(board.body.message).toBe("grades_not_released");
});

test("judge and team are kept out of the consoles before release", async ({ browser }) => {
  const judge = await signIn(browser, fx.judge);
  await expectHackathonNotFound(judge, `${hackathonUrl()}/admin`);
  await judge.goto(`${hackathonUrl()}/judge`);
  await expect(judge.getByText("Finals open after release.")).toBeVisible();
  expect((await judge.request.get(`/api/hackathons/${fx.slug}/export`)).status()).toBe(404);
  expect((await judge.request.get(`/api/hackathons/${fx.slug}/export/submissions`)).status()).toBe(404);

  const team = await signIn(browser, fx.lead);
  await expectHackathonNotFound(team, `${hackathonUrl()}/admin`);
  await expectHackathonNotFound(team, `${hackathonUrl()}/judge`);
  expect((await team.request.get(`/api/hackathons/${fx.slug}/export`)).status()).toBe(404);
  expect((await team.request.get(`/api/hackathons/${fx.slug}/export/submissions`)).status()).toBe(404);
});

test("a closed window refuses a submission", async ({ browser }) => {
  // Operator SQL moves the close; here, the service role.
  await rest(svc!, `hackathons?id=eq.${fx.hackathonId}`, {
    method: "PATCH",
    body: { closes_at: new Date(Date.now() - 60_000).toISOString() },
    prefer: "return=minimal",
  });

  const page = await signIn(browser, fx.lead);
  await page.goto(hackathonUrl());
  await expect(page.getByRole("button", { name: "Update submission", exact: true })).toBeDisabled();

  // And the server, not only the button.
  const [version] = await rest<{ image_paths: string[]; member_ids: string[] }[]>(
    svc!,
    `hackathon_submission_versions?id=eq.${versions.at(-1)}&select=image_paths,member_ids`,
  );
  const token = await tokenFor(svc!, publishableKey, fx.lead);
  const refused = await rpcAs(svc!, publishableKey, token, "submit_hackathon_entry", {
    p_hackathon_id: fx.hackathonId,
    p_project_id: fx.projectId,
    p_team_name: teamNameV2(),
    p_member_ids: version.member_ids,
    p_image_paths: version.image_paths,
  });
  expect(refused.body.code).toBe("QD409");
  expect(refused.body.message).toBe("hackathon_closed");
});

test("a late pass lets the team submit again", async ({ browser }) => {
  const admin = await signIn(browser, fx.admin);
  await admin.goto(`${hackathonUrl()}/admin`);
  const row = admin.getByRole("row", { name: new RegExp(teamNameV2()) });
  await row.getByRole("button", { name: "Late pass" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.getByLabel("Until (Asia/Manila)").fill(manilaLocal(Date.now() + 20 * 60_000));
  await dialog.getByRole("button", { name: "Save late pass" }).click();
  await expect(admin.getByText("Late pass saved.")).toBeVisible();

  const team = await signIn(browser, fx.lead);
  await team.goto(hackathonUrl());
  await team.getByRole("button", { name: "Update submission", exact: true }).click();
  await team.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(team.getByText("Submission received.").first()).toBeVisible();
  await expect(team.locator("article", { hasText: teamNameV2() })).toContainText("3 versions");

  // End the pass (a time in the past), or release refuses with late_pass_active.
  const token = await tokenFor(svc!, publishableKey, fx.admin);
  const ended = await rpcAs(svc!, publishableKey, token, "grant_late_pass", {
    p_hackathon_id: fx.hackathonId,
    p_project_id: fx.projectId,
    p_until: new Date(Date.now() - 1_000).toISOString(),
  });
  expect(ended.status, JSON.stringify(ended.body)).toBeLessThan(300);
});

test("grading jobs complete with synthetic runs, and the console shows it without scores", async ({ browser }) => {
  test.setTimeout(240_000);
  await completeGradingSynthetically(svc!, fx.hackathonId);

  const page = await signIn(browser, fx.admin);
  await page.goto(`${hackathonUrl()}/admin`);
  const row = page.getByRole("row", { name: new RegExp(teamNameV2()) });
  await expect(row).toContainText("2 done · 0 pending · 0 running");
  await expect(row).toContainText("complete");
  await expect(page.getByText(SYNTHETIC_TOTAL.toFixed(2))).toHaveCount(0);
});

test("the admin releases grades", async ({ browser }) => {
  const page = await signIn(browser, fx.admin);
  await page.goto(`${hackathonUrl()}/admin`);
  await page.getByRole("button", { name: "Release grades", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Release permanently" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(`Type ${fx.slug}`).fill(fx.slug);
  await confirm.click();
  await expect(page.getByText(/^Grades released\. 1 finalists?\.$/)).toBeVisible();

  await page.reload();
  await expect(page.getByText(/^Released /)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
});

test("the leaderboard is visible to the admin only", async ({ browser }) => {
  const admin = await signIn(browser, fx.admin);
  await admin.goto(`${hackathonUrl()}/admin`);
  const board = admin.getByRole("table").first();
  await expect(board.getByText("AI /100")).toBeVisible();
  const row = board.getByRole("row", { name: new RegExp(teamNameV2()) });
  await expect(row).toContainText(SYNTHETIC_TOTAL.toFixed(2));
  await expect(row).toContainText("Finalist");

  const judge = await signIn(browser, fx.judge);
  await expectHackathonNotFound(judge, `${hackathonUrl()}/admin`);
  expect((await judge.request.get(`/api/hackathons/${fx.slug}/export`)).status()).toBe(404);

  const team = await signIn(browser, fx.lead);
  await expectHackathonNotFound(team, `${hackathonUrl()}/admin`);
  await expectHackathonNotFound(team, `${hackathonUrl()}/judge`);
  expect((await team.request.get(`/api/hackathons/${fx.slug}/export`)).status()).toBe(404);
  await team.goto(hackathonUrl());
  await expect(team.locator("article", { hasText: teamNameV2() }).getByText("Received", { exact: true })).toBeVisible();
  expect(await bodyText(team)).not.toMatch(GRADE_WORDS);

  // The database agrees: only an admin reads grades.
  for (const account of [fx.judge, fx.lead]) {
    const token = await tokenFor(svc!, publishableKey, account);
    const refused = await rpcAs(svc!, publishableKey, token, "hackathon_leaderboard", {
      p_hackathon_id: fx.hackathonId,
    });
    expect(refused.body.code, account.username).toBe("42501");
  }
});

test("the judge scores the finalist", async ({ browser }) => {
  const page = await signIn(browser, fx.judge);
  await page.goto(`${hackathonUrl()}/judge`);
  const finalist = page.locator("li", { has: page.getByRole("heading", { name: teamNameV2() }) });
  await expect(finalist).toBeVisible();
  // Never an AI score on the judge's page.
  await expect(page.getByText(SYNTHETIC_TOTAL.toFixed(2))).toHaveCount(0);

  for (const [criterion, points] of [
    ["Clarity", 4],
    ["Structure", 4],
    ["Accuracy", 5],
    ["Connections", 3],
    ["Pitch", 4],
  ] as const) {
    await finalist.getByRole("radio", { name: `${criterion} ${points}`, exact: true }).click();
  }
  await expect(finalist).toContainText("Your total: 20 / 25");
  await finalist.getByRole("button", { name: "Save score" }).click();
  await expect(page.getByText(`Saved your score for ${teamNameV2()}.`)).toBeVisible();

  const admin = await signIn(browser, fx.admin);
  await admin.goto(`${hackathonUrl()}/admin`);
  const row = admin.getByRole("table").first().getByRole("row", { name: new RegExp(teamNameV2()) });
  await expect(row).toContainText("20.00");
  await expect(row).toContainText("(1 judge)");
});

test("the CSV download matches the screen", async ({ browser }) => {
  const page = await signIn(browser, fx.admin);
  await page.goto(`${hackathonUrl()}/admin`);

  const row = page.getByRole("table").first().getByRole("row", { name: new RegExp(teamNameV2()) });
  await expect(row).toContainText("(1 judge)");
  const cells = await row.getByRole("cell").allInnerTexts();
  expect(cells).toHaveLength(14);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export results" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`${fx.slug}-results.csv`);
  const csv = await readFile((await download.path())!, "utf8");
  const [header, ...lines] = csv.trimEnd().split("\r\n");
  expect(header).toBe("rank,team_name,project_slug,eligible,ai_total,human_mean,finalist,flags");
  expect(lines).toHaveLength(1);

  const [rank, team, project, eligible, aiTotal, humanMean, finalist] = lines[0].split(",");
  expect(rank).toBe(cells[0].trim());
  expect(team).toBe(cells[1].trim());
  expect(project).toBe(cells[2].trim());
  expect(eligible).toBe("true");
  expect(aiTotal).toBe(cells[4].trim());
  expect(humanMean).toBe(cells[13].match(/^\s*([\d.]+)/)?.[1]);
  expect(finalist).toBe("true");
  expect(project).toBe(fx.projectSlug);
});
