import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { env } from "./env";
import { connect, doqtriAppsPanel, openPair, revokeInQdit, startDisconnected, type Pair } from "./pair";
import { qditRestAs, serviceRest } from "./rest";
import {
  H_BUILD,
  api,
  cleanUp,
  clientToken,
  createQditProject,
  linkNoteToProject,
  milestoneFromHeading,
  seedNote,
  type QditProject,
} from "./world";

/**
 * Connection 2 again, after the person takes it back (WP-2.10; D-59, D-75,
 * D-76; contract section 5). Release plan S6 step 6, automated.
 *
 * Revoking doqtri in qdit's Settings must refuse that app's current tokens
 * at once: on /api/v1, and on PostgREST writes through the guarded tables
 * and RPCs, even though the access token's `exp` is still ahead. doqtri's
 * refresh is refused too, so doqtri asks for a reconnect, and qdit's doc card
 * says the connection is lost. A new consent works again.
 */

let pair: Pair;
let project: QditProject;
let note: { id: string; title: string };
let milestoneId: string;
let token: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  pair = await openPair(browser);
  await startDisconnected(pair);
  await connect(pair);
  project = await createQditProject(pair.qdit.id);
  note = await seedNote(pair.doqtri.id, pair.doqtri.workspaceId);
  await linkNoteToProject(pair.context, note.id, project.id);
  milestoneId = (await milestoneFromHeading(pair.context, note.id, H_BUILD)).qdit_milestone_id;
  token = (await clientToken(pair.context)).access;
});

test.afterAll(async () => {
  await cleanUp({ projects: project ? [project] : [], notes: note ? [note] : [] });
  await pair?.context.close();
});

function docCard() {
  return pair.page.locator('[data-slot="doqtri-doc-card"]');
}

test("before the revoke, the token works and the doc card is live", async () => {
  expect((await api(token, "GET", "/me")).status).toBe(200);
  await pair.page.goto(`${env().qditOrigin}/projects/${project.slug}`);
  await expect(docCard()).toHaveAttribute("data-state", "loaded");
  await expect(docCard()).toContainText(note.title);
});

test("revoking in qdit refuses the app's live token at once, on /api/v1 and on writes (D-59, D-75)", async () => {
  expect(await revokeInQdit(pair.page)).toBe(true);
  // The token's exp is still ahead; only the revoke can refuse it.
  expect(Number((JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { exp: number }).exp) * 1000).toBeGreaterThan(
    Date.now(),
  );

  const me = await api(token, "GET", "/me");
  expect(me.status).toBe(401);
  expect(me.headers.get("www-authenticate")).toContain('error="invalid_token"');

  // A writing RPC with the same token, straight at PostgREST (D-75).
  const rpc = await qditRestAs(token, "rpc/link_project_doc", {
    method: "POST",
    body: {
      p_project_id: project.id,
      p_doc_id: randomUUID(),
      p_doc_title: "After revoke",
      p_doc_url: `${env().doqtriOrigin}/d/${randomUUID()}`,
    },
  });
  expect(rpc.ok).toBe(false);
  expect(((await rpc.json()) as { code?: string }).code).toBe("42501");

  // A guarded table write: RLS filters it to nothing.
  await qditRestAs(token, `milestones?id=eq.${milestoneId}`, { method: "PATCH", body: { title: "Renamed after revoke" } });
  const [milestone] = await serviceRest<{ title: string }[]>("qdit", `milestones?id=eq.${milestoneId}&select=title`);
  expect(milestone.title).toBe(H_BUILD.nodeLabel);
});

test("doqtri turns the revoked grant into Reconnect; qdit's doc card says the connection is lost", async () => {
  const projects = await pair.context.request.get(`${env().doqtriOrigin}/api/integrations/qdit/projects`);
  expect(projects.status()).toBe(409);
  expect(((await projects.json()) as { code: string }).code).toBe("QDIT_NOT_CONNECTED");
  await expect(await doqtriAppsPanel(pair.page)).toHaveText("Reconnect needed");

  await pair.page.goto(`${env().qditOrigin}/projects/${project.slug}`);
  await expect(docCard()).toHaveAttribute("data-state", "not-connected");
  await expect(docCard()).toContainText("Connection to doqtri lost");
});

test("reconnecting after the revoke works again", async () => {
  // iat has whole seconds; a grant in the revoke's own second is refused too (D-76).
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await connect(pair);

  const projects = await pair.context.request.get(`${env().doqtriOrigin}/api/integrations/qdit/projects`);
  expect(projects.status(), await projects.text()).toBe(200);
  expect((await api((await clientToken(pair.context)).access, "GET", "/me")).status).toBe(200);

  await pair.page.goto(`${env().qditOrigin}/projects/${project.slug}`);
  await expect(docCard()).toHaveAttribute("data-state", "loaded");
});
