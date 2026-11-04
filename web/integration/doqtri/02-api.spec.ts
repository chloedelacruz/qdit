import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { env } from "./env";
import { connect, openPair, startDisconnected, type Pair } from "./pair";
import { serviceRest } from "./rest";
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
 * Connection 2, API calls (WP-2.1, WP-2.4; contract sections 6 to 8).
 *
 * doqtri's server calls qdit's /api/v1 with the person's bearer token. Half
 * of this spec drives doqtri's own integration routes and checks what landed
 * in qdit; the other half calls /api/v1 directly with a doqtri-client token,
 * for the refusals doqtri itself never provokes (an off-origin doc_url, an
 * unsupported method).
 */

let pair: Pair;
let project: QditProject;
let note: { id: string; title: string };
let token: string;

test.beforeAll(async ({ browser }) => {
  pair = await openPair(browser);
  await startDisconnected(pair);
  await connect(pair);
  project = await createQditProject(pair.qdit.id);
  note = await seedNote(pair.doqtri.id, pair.doqtri.workspaceId);
  token = (await clientToken(pair.context)).access;
});

test.afterAll(async () => {
  await cleanUp({ projects: project ? [project] : [], notes: note ? [note] : [] });
  await pair?.context.close();
});

test("doqtri lists the qdit project, as qdit's owner can link it", async () => {
  const res = await pair.context.request.get(`${env().doqtriOrigin}/api/integrations/qdit/projects`);
  expect(res.status(), await res.text()).toBe(200);
  const { projects } = (await res.json()) as { projects: { id: string; can_link: boolean }[] };
  expect(projects.find((p) => p.id === project.id)).toMatchObject({ can_link: true });

  const direct = await api(token, "GET", "/projects?limit=100");
  expect(direct.status).toBe(200);
  const { data } = (await direct.json()) as { data: { id: string; role: string; chain: unknown }[] };
  expect(data.find((p) => p.id === project.id)).toMatchObject({ role: "owner", chain: null });
});

test("linking a note in doqtri writes qdit's doc link, on doqtri's public doc URL (D-45)", async () => {
  await linkNoteToProject(pair.context, note.id, project.id);

  const rows = await serviceRest<{ doc_id: string; doc_title: string; doc_url: string }[]>(
    "qdit",
    `project_doc_links?project_id=eq.${project.id}&select=doc_id,doc_title,doc_url`,
  );
  expect(rows).toEqual([{ doc_id: note.id, doc_title: note.title, doc_url: `${env().doqtriOrigin}/d/${note.id}` }]);
});

test("a milestone made from a heading in doqtri is a linked qdit milestone", async () => {
  const link = await milestoneFromHeading(pair.context, note.id, H_BUILD);

  const res = await api(token, "GET", `/milestones/${link.qdit_milestone_id}`);
  expect(res.status).toBe(200);
  const { data } = (await res.json()) as {
    data: { title: string; status: string; project: { id: string }; link: { id: string; doc_id: string; node_id: string; node_label: string } };
  };
  expect(data).toMatchObject({
    title: H_BUILD.nodeLabel,
    status: "proposed",
    project: { id: project.id },
    link: { id: link.qdit_link_id, doc_id: note.id, node_id: H_BUILD.nodeId, node_label: H_BUILD.nodeLabel },
  });

  // The same heading twice is a conflict that names the existing milestone.
  const again = await api(token, "POST", "/milestones", {
    project_id: project.id,
    title: H_BUILD.nodeLabel,
    link: { doc_id: note.id, node_id: H_BUILD.nodeId, doc_version: null },
  });
  expect(again.status).toBe(409);
  const conflict = (await again.json()) as { error: { code: string; details: { reason: string; milestone_id?: string } } };
  expect(conflict.error.details).toMatchObject({ reason: "node_already_linked", milestone_id: link.qdit_milestone_id });
});

test("qdit refuses a doc_url off doqtri's origin, in the API and in the database (D-45, D-95)", async () => {
  const origin = env().doqtriOrigin;
  const { host } = new URL(origin);
  const docId = randomUUID();
  for (const docUrl of [
    origin,
    `${origin}?x`,
    `${origin}#x`,
    `https://${host}.example.com/d/${docId}`,
    `${origin.replace(/^https:/, "http:")}/d/${docId}`,
  ]) {
    if (docUrl === `${origin}/d/${docId}`) continue; // http origin (local run): the http case is the origin itself
    const res = await api(token, "POST", `/projects/${project.id}/docs`, { doc_id: docId, doc_title: "Off origin", doc_url: docUrl });
    expect(res.status, docUrl).toBe(400);
    const body = (await res.json()) as { error: { code: string; details: { fields: Record<string, string> } } };
    expect(body.error.code, docUrl).toBe("invalid_request");
    expect(Object.keys(body.error.details.fields), docUrl).toContain("doc_url");
  }
  const stored = await serviceRest<unknown[]>("qdit", `project_doc_links?doc_id=eq.${docId}&select=doc_id`);
  expect(stored).toEqual([]);
});

test("a method /api/v1 does not support is 404 not_found, never 405 (D-27)", async () => {
  for (const [method, path] of [
    ["PUT", "/me"],
    ["DELETE", "/projects"],
    ["HEAD", "/me"],
    ["OPTIONS", "/projects"],
  ] as const) {
    const res = await api(token, method, path);
    expect(res.status, `${method} ${path}`).toBe(404);
    expect(res.headers.get("allow"), `${method} ${path}`).toBeNull();
  }
});

test("unlinking in doqtri removes qdit's doc link and frees the milestone (D-22)", async () => {
  const res = await pair.context.request.delete(`${env().doqtriOrigin}/api/integrations/qdit/docs/${note.id}/project`);
  expect(res.status(), await res.text()).toBe(200);

  expect(await serviceRest<unknown[]>("qdit", `project_doc_links?project_id=eq.${project.id}&select=doc_id`)).toEqual([]);
  const milestones = await serviceRest<{ id: string }[]>("qdit", `milestones?project_id=eq.${project.id}&select=id`);
  expect(milestones).toHaveLength(1);
  const after = await api(token, "GET", `/milestones/${milestones[0].id}`);
  expect(((await after.json()) as { data: { link: unknown } }).data.link).toBeNull();
});
