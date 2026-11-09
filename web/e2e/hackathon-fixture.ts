import { randomBytes } from "node:crypto";

import { rest, type Service } from "./service";

/**
 * Fixtures for `hackathon.spec.ts` (WP-4.7, QDIT-49), and the sweep that
 * removes them.
 *
 * Everything the spec makes is reachable from one of three markers, so a
 * crashed run is cleaned up by the next one (`cleanup.teardown.ts` calls
 * `sweepE2eHackathons` too):
 *
 *   hackathons.slug   `e2e-<run id>`        cascades to every hackathon row
 *   projects.name     `e2e project hackathon-<run id>`
 *   auth.users.email  `e2e-hackathon-<run id>-<role>@example.invalid`,
 *                     username `e2eh_<run id>_<role>` (how the sweep finds them)
 *
 * Storage objects do not cascade from a row, so the sweep deletes everything
 * under `<hackathon id>/` in the `hackathon-mindmaps` bucket first, through
 * the Storage API, and then checks that nothing is left.
 *
 * Accounts get a random password generated here and never written anywhere;
 * `example.invalid` cannot receive mail (RFC 2606).
 */

export const SLUG_PREFIX = "e2e-";
export const EMAIL_PREFIX = "e2e-hackathon-";
export const PROJECT_PREFIX = "e2e project hackathon-";
/** Every account's username starts with this (`e2eh_<run id>_<role>`). */
export const USERNAME_PREFIX = "e2eh_";
export const BUCKET = "hackathon-mindmaps";

/** A 1x1 PNG, the smallest image the bucket accepts. */
export const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export type Account = {
  id: string;
  email: string;
  password: string;
  username: string;
  name: string;
};

export type Fixture = {
  runId: string;
  slug: string;
  hackathonId: string;
  projectId: string;
  projectSlug: string;
  admin: Account;
  judge: Account;
  /** Project owner: the one who submits. */
  lead: Account;
  members: [Account, Account];
};

function authHeaders(svc: Service): Record<string, string> {
  return { apikey: svc.headers.apikey, Authorization: svc.headers.Authorization };
}

/** True when the hackathon migration is applied where `svc` points. */
export async function hackathonsAvailable(svc: Service): Promise<boolean> {
  const response = await fetch(`${svc.url}/rest/v1/hackathons?select=id&limit=1`, { headers: svc.headers });
  return response.ok;
}

async function createAccount(svc: Service, runId: string, role: string, name: string): Promise<Account> {
  const email = `${EMAIL_PREFIX}${runId}-${role}@example.invalid`;
  const password = randomBytes(18).toString("base64url");
  const username = `${USERNAME_PREFIX}${runId}_${role}`.slice(0, 30);
  const response = await fetch(`${svc.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...authHeaders(svc), "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, full_name: name },
    }),
  });
  const body = (await response.json()) as { id?: string; msg?: string };
  if (!response.ok || !body.id) throw new Error(`creating ${email}: ${response.status} ${body.msg ?? ""}`);
  return { id: body.id, email, password, username, name };
}

/** The hackathon, its first admin, a judge-to-be, and a team project with three members. */
export async function createFixture(svc: Service, runId: string): Promise<Fixture> {
  const [admin, judge, lead, m1, m2] = await Promise.all([
    createAccount(svc, runId, "admin", `e2e Admin ${runId}`),
    createAccount(svc, runId, "judge", `e2e Judge ${runId}`),
    createAccount(svc, runId, "lead", `e2e Lead ${runId}`),
    createAccount(svc, runId, "m1", `e2e Member One ${runId}`),
    createAccount(svc, runId, "m2", `e2e Member Two ${runId}`),
  ]);

  const slug = `${SLUG_PREFIX}${runId}`;
  const now = Date.now();
  const [hackathon] = await rest<{ id: string }[]>(svc, "hackathons", {
    method: "POST",
    body: {
      slug,
      name: `e2e hackathon ${runId}`,
      description: "End-to-end test event. Removed by the teardown.",
      opens_at: new Date(now - 30 * 60_000).toISOString(),
      closes_at: new Date(now + 60 * 60_000).toISOString(),
      team_min: 3,
      team_max: 4,
      finalist_count: 10,
    },
  });

  // Operator SQL in production; the first admin has no RPC (D-115).
  await rest(svc, "hackathon_staff", {
    method: "POST",
    body: { hackathon_id: hackathon.id, user_id: admin.id, role: "admin" },
    prefer: "return=minimal",
  });

  const projectSlug = `e2e-project-hackathon-${runId}`;
  const [project] = await rest<{ id: string }[]>(svc, "projects", {
    method: "POST",
    body: { owner_id: lead.id, name: `${PROJECT_PREFIX}${runId}`, slug: projectSlug, status: "active" },
  });
  // The owner's membership row comes from the project trigger.
  await rest(svc, "project_members", {
    method: "POST",
    body: [m1, m2].map((m) => ({ project_id: project.id, user_id: m.id, role: "member" })),
    prefer: "return=minimal",
  });

  const due = new Date(now + 2 * 86_400_000).toISOString().slice(0, 10);
  const people = [lead, m1, m2];
  await rest(svc, "tasks", {
    method: "POST",
    body: ["Sketch the problem map", "Pick the solution branch", "Wire the demo", "Write the pitch", "Record the walkthrough"].map(
      (title, i) => ({
        project_id: project.id,
        title: `${title} (e2e ${runId})`,
        status: i < 2 ? "done" : i < 4 ? "in_progress" : "todo",
        priority: ["high", "medium", "urgent", "low", "medium"][i],
        assignee_id: people[i % people.length].id,
        due_date: due,
        order_index: i,
      }),
    ),
    prefer: "return=minimal",
  });

  return {
    runId,
    slug,
    hackathonId: hackathon.id,
    projectId: project.id,
    projectSlug,
    admin,
    judge,
    lead,
    members: [m1, m2],
  };
}

/** An access token for `account`, by password, as the browser's client would get one. */
export async function tokenFor(svc: Service, publishableKey: string, account: Account): Promise<string> {
  const response = await fetch(`${svc.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error(`signing in ${account.email}: ${response.status}`);
  return body.access_token;
}

/** An RPC as a signed-in user. Answers the status and the parsed body; never throws on a refusal. */
export async function rpcAs(
  svc: Service,
  publishableKey: string,
  token: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: { code?: string; message?: string } & Record<string, unknown> }> {
  const response = await fetch(`${svc.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

/* -------------------------------------------------------------------------- */
/* Grading with synthetic runs                                                */
/* -------------------------------------------------------------------------- */

const SYNTHETIC = { clarity: 8, structure: 7, accuracy: 9, connections: 6, execution: 8 } as const;
/** rubric.ts: total = sum of score/10 x 20. */
export const SYNTHETIC_TOTAL = Object.values(SYNTHETIC).reduce((sum, s) => sum + (s / 10) * 20, 0);

type Claimed = { job_id: string; attempts: number };

/**
 * Settles every live grading job of the entry's current version with a
 * synthetic run, through the service-role RPCs the worker uses
 * (claim_grading_jobs, complete_grading_job), then stores an eligible gate
 * result (set_version_eligibility). No model is called.
 *
 * A job another worker already holds (production's pg_cron sweep, or the
 * submit's `after()` when the local server has an Anthropic key) is waited
 * for rather than raced: the claim skips it and the loop polls until it is
 * settled. Returns the version id.
 */
export async function completeGradingSynthetically(svc: Service, hackathonId: string, timeoutMs = 150_000): Promise<string> {
  const [submission] = await rest<{ current_version_id: string }[]>(
    svc,
    `hackathon_submissions?hackathon_id=eq.${hackathonId}&select=current_version_id`,
  );
  const versionId = submission.current_version_id;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const claimed = await rest<Claimed[]>(svc, "rpc/claim_grading_jobs", {
      method: "POST",
      body: { p_limit: 5, p_lease_seconds: 60, p_version_id: versionId },
    });
    for (const job of claimed) {
      const outcome = await rest<string>(svc, "rpc/complete_grading_job", {
        method: "POST",
        body: {
          p_job_id: job.job_id,
          p_attempt: job.attempts,
          p_model: "e2e-synthetic",
          p_criteria: Object.fromEntries(
            Object.entries(SYNTHETIC).map(([key, score]) => [key, { score, evidence: "e2e synthetic run" }]),
          ),
          p_total: SYNTHETIC_TOTAL,
          p_flags: [],
          p_summary: "Synthetic run written by the e2e suite. No model was called.",
          p_stop_reason: "end_turn",
          p_usage: null,
          p_truncated: false,
        },
      });
      if (outcome !== "done") throw new Error(`complete_grading_job answered ${outcome}`);
    }

    const live = await rest<{ status: string }[]>(
      svc,
      `hackathon_grading_jobs?version_id=eq.${versionId}&status=neq.superseded&select=status`,
    );
    if (live.length > 0 && live.every((j) => j.status === "done" || j.status === "failed")) break;
    if (Date.now() > deadline) throw new Error(`grading jobs still open: ${live.map((j) => j.status).join(", ")}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }

  await rest(svc, "rpc/set_version_eligibility", {
    method: "POST",
    body: { p_version_id: versionId, p_eligibility: { eligible: true, rules: [] } },
    prefer: "return=minimal",
  });
  return versionId;
}

/* -------------------------------------------------------------------------- */
/* Teardown                                                                   */
/* -------------------------------------------------------------------------- */

type StorageEntry = { name: string; id: string | null };

async function listStorage(svc: Service, prefix: string): Promise<StorageEntry[]> {
  const response = await fetch(`${svc.url}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...authHeaders(svc), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!response.ok) throw new Error(`listing ${BUCKET}/${prefix}: ${response.status} ${await response.text()}`);
  return (await response.json()) as StorageEntry[];
}

/** Every object path under `<hackathonId>/` (paths are `<hackathon>/<project>/<file>`). */
export async function storagePaths(svc: Service, hackathonId: string): Promise<string[]> {
  const paths: string[] = [];
  for (const folder of await listStorage(svc, hackathonId)) {
    const prefix = `${hackathonId}/${folder.name}`;
    if (folder.id !== null) {
      paths.push(prefix);
      continue;
    }
    for (const file of await listStorage(svc, prefix)) {
      if (file.id !== null) paths.push(`${prefix}/${file.name}`);
    }
  }
  return paths;
}

async function deleteStorage(svc: Service, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const response = await fetch(`${svc.url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...authHeaders(svc), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }),
    });
    if (!response.ok) throw new Error(`deleting from ${BUCKET}: ${response.status} ${await response.text()}`);
  }
}

/**
 * Removes every `e2e-` hackathon with its Storage objects, the `e2e project
 * hackathon-` projects and the `e2eh_` accounts (by username), then checks that
 * none of them is left. Throws when something remains.
 */
export async function sweepE2eHackathons(svc: Service): Promise<{ hackathons: number; objects: number; accounts: number }> {
  const hackathons = await rest<{ id: string }[]>(svc, `hackathons?slug=like.${SLUG_PREFIX}*&select=id`);

  let objects = 0;
  for (const { id } of hackathons) {
    const paths = await storagePaths(svc, id);
    await deleteStorage(svc, paths);
    objects += paths.length;
  }
  for (const { id } of hackathons) {
    await rest(svc, `hackathons?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  }

  await rest(svc, `projects?name=like.${encodeURIComponent(PROJECT_PREFIX)}*`, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  // Found by username rather than by listing auth.users: the profile row is
  // the account's (same id), and the admin list is paginated.
  const mine = await rest<{ id: string; username: string }[]>(
    svc,
    `profiles?username=like.${USERNAME_PREFIX}*&select=id,username`,
  );
  for (const user of mine) {
    const deleted = await fetch(`${svc.url}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: authHeaders(svc) });
    if (!deleted.ok && deleted.status !== 404) throw new Error(`deleting @${user.username}: ${deleted.status}`);
  }

  // Nothing left: rows, objects, projects.
  const rows = await rest<unknown[]>(svc, `hackathons?slug=like.${SLUG_PREFIX}*&select=id`);
  const leftovers = (await Promise.all(hackathons.map(({ id }) => storagePaths(svc, id)))).flat();
  const projects = await rest<unknown[]>(svc, `projects?name=like.${encodeURIComponent(PROJECT_PREFIX)}*&select=id`);
  const accounts = await rest<unknown[]>(svc, `profiles?username=like.${USERNAME_PREFIX}*&select=id`);
  if (rows.length + leftovers.length + projects.length + accounts.length > 0) {
    throw new Error(
      `e2e hackathon teardown left ${rows.length} hackathon(s), ${leftovers.length} object(s), ${projects.length} project(s), ${accounts.length} account(s)`,
    );
  }

  return { hackathons: hackathons.length, objects, accounts: mine.length };
}
