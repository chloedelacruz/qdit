import { readFile } from "node:fs/promises";

import { expect, request as playwrightRequest, test } from "@playwright/test";

import { MILESTONES, PROJECT } from "./seed";
import { NO_SERVICE, rest, service } from "./service";

/**
 * The two downloads: the project's anchor history as CSV, and one milestone's
 * proof certificate as a self-contained HTML file.
 *
 * Both are files someone files away and opens months later, so the assertions
 * are about the file — its name, its type, its header row, its title — rather
 * than about a button. Both routes sit behind the auth gate, and a signed-out
 * request is checked too, because an export that leaked to anyone with the URL
 * would be the expensive bug.
 *
 * Read-only: nothing is written, so this runs beside the other read specs.
 */

const CSV_HEADER =
  "milestone,status,action,version,digest,tx_hash,ledger,network,signer,timestamp_utc";

/** The seeded milestone the certificate is for, by title within the seeded project. */
async function approvedMilestoneId(): Promise<string | null> {
  const svc = service();
  if (!svc) return null;

  const rows = await rest<{ id: string }[]>(
    svc,
    `milestones?project_id=eq.${PROJECT.id}&title=eq.${encodeURIComponent(MILESTONES.approved)}&select=id`,
  );
  return rows[0]?.id ?? null;
}

test.describe("anchor history export", () => {
  test("downloads a CSV named for the project and dated, with the documented header", async ({
    page,
  }) => {
    await page.goto(`/projects/${PROJECT.slug}/proofs`);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Anchors CSV" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^qdit-anchors-${PROJECT.slug}-\\d{4}-\\d{2}-\\d{2}\\.csv$`),
    );

    const body = await readFile((await download.path())!, "utf8");
    const [header, ...rows] = body.split("\r\n").filter((line) => line.length > 0);

    expect(header).toBe(CSV_HEADER);
    // Every data row has the header's ten columns. Quoted fields may contain
    // commas, so count with a CSV-aware split rather than `split(",")`.
    for (const row of rows) {
      expect(row.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.filter(Boolean).length).toBe(10);
    }
  });

  test("the route answers text/csv as an attachment", async ({ page }) => {
    const response = await page.request.get(`/api/export/anchors?project=${PROJECT.slug}`);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="qdit-anchors-/);
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("a missing or unknown project is refused, not an empty file", async ({ page }) => {
    expect((await page.request.get("/api/export/anchors")).status()).toBe(400);
    expect(
      (await page.request.get("/api/export/anchors?project=no-such-project-e2e")).status(),
    ).toBe(404);
  });
});

test.describe("proof certificate export", () => {
  test("downloads one HTML file titled for the milestone and project", async ({ page }) => {
    test.skip(!service(), NO_SERVICE);

    const milestoneId = await approvedMilestoneId();
    expect(milestoneId, `no seeded milestone titled "${MILESTONES.approved}"`).toBeTruthy();

    const response = await page.request.get(
      `/api/export/certificate?project=${PROJECT.slug}&milestone=${milestoneId}`,
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers()["content-disposition"]).toBe(
      `attachment; filename="qdit-certificate-${PROJECT.slug}-${milestoneId!.slice(0, 8)}.html"`,
    );

    const html = await response.text();
    expect(html).toContain(
      `<title>Proof certificate — ${MILESTONES.approved} — ${PROJECT.name}</title>`,
    );
    // Self-contained is the promise: no script, stylesheet or image is
    // fetched from anywhere when the file is opened.
    expect(html).not.toMatch(/<script\b|<link\b[^>]*rel="stylesheet"|<img\b[^>]*src="http/i);
  });

  test("a missing milestone or one outside the project is refused", async ({ page }) => {
    expect(
      (await page.request.get(`/api/export/certificate?project=${PROJECT.slug}`)).status(),
    ).toBe(400);
    expect(
      (
        await page.request.get(
          `/api/export/certificate?project=${PROJECT.slug}&milestone=00000000-0000-4000-8000-000000000000`,
        )
      ).status(),
    ).toBe(404);
  });
});

/**
 * Signed out, both exports answer 401 rather than redirecting to /login: they
 * are fetched as files, and a login page saved as `.csv` is a worse failure
 * than a refusal. A fresh request context carries no session cookie.
 */
test("both exports refuse a signed-out request", async ({ baseURL }) => {
  const anon = await playwrightRequest.newContext({ baseURL, storageState: undefined });

  try {
    const anchors = await anon.get(`/api/export/anchors?project=${PROJECT.slug}`, {
      maxRedirects: 0,
    });
    expect(anchors.status()).toBe(401);

    const certificate = await anon.get(
      `/api/export/certificate?project=${PROJECT.slug}&milestone=00000000-0000-4000-8000-000000000000`,
      { maxRedirects: 0 },
    );
    expect(certificate.status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});
