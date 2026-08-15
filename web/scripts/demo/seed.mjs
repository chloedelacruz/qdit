/**
 * Builds the workspace the demo video walks through, and removes it again.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * A walkthrough needs a project that looks lived-in: a team, milestones at
 * different stages, and a rejection that already happened — the last one being
 * the story the History view and the public proof page exist to tell, and the
 * one that takes days to accumulate honestly.
 *
 * Everything created here is **scenery, not evidence**. The accounts are not
 * users and must not be counted as any; the seed marks them so they are easy to
 * tell apart and easy to delete. Nothing here signs a contract transaction —
 * every anchor in the video is signed live, on camera, from a real wallet, and
 * lands on a ledger anyone can check.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/demo/seed.mjs             # create (idempotent)
 *   node scripts/demo/seed.mjs --clean     # remove everything it created
 *
 * Needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` — read from
 * `.env.local` if present. The secret key bypasses RLS, which is the point:
 * this writes rows on behalf of four accounts that will never sign in.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NOTIFICATIONS COME OUT RIGHT
 * ---------------------------------------------------------------------------
 * `notify_milestone_status()` excludes whoever caused the change, read from
 * `auth.uid()`. Writing through the service key means there is no JWT and
 * `auth.uid()` is null, so nobody is excluded and every member of the project —
 * including you — ends up with unread notifications. That is what puts a count
 * on the bell for the camera.
 *
 * It is also why the bell stays empty when you test alone: on a one-member
 * project the only possible recipient is always the actor.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WALLETS = join(HERE, ".wallets.json");

/* -------------------------------------------------------------------------- */
/* The demo workspace                                                         */
/* -------------------------------------------------------------------------- */

/** Every row this script creates is reachable from one of these two markers. */
const PROJECT_SLUG = "demo-aurora-payments";
const EMAIL_DOMAIN = "@demo.qdit.test";

const PROJECT = {
  name: "Aurora Payments",
  slug: PROJECT_SLUG,
  description:
    "Remittance corridor pilot. Demo workspace — seeded for the product walkthrough, not a real engagement.",
  status: "active",
};

/**
 * Four milestones spanning the whole state machine, so the walkthrough has one
 * of each without having to invent them on camera.
 *
 * `submitted` is the one you reject during the video. `rejectThenApprove`
 * already carries a decision history, which is what the History view and the
 * public proof page are for.
 */
const MILESTONES = [
  {
    key: "approved",
    title: "Corridor research and partner shortlist",
    description: "Compare settlement costs across three corridors and pick two to pilot.",
    status: "approved",
    order: 0,
    history: [{ from: "submitted", to: "approved", reason: "Numbers check out. Good writeup." }],
  },
  {
    key: "rejectThenApprove",
    title: "Payout reconciliation service",
    description:
      "Match on-chain settlements against the partner's ledger export, nightly, with a discrepancy report.",
    status: "approved",
    order: 1,
    history: [
      {
        from: "submitted",
        to: "rejected",
        reason:
          "The reconciliation job points at the staging export, not production. Repoint it and resubmit — everything else looks right.",
      },
      { from: "rejected", to: "submitted", reason: null },
      { from: "submitted", to: "approved", reason: "Repointed and verified against last week's export." },
    ],
  },
  {
    key: "submitted",
    title: "Compliance review pack",
    description:
      "KYC flow, retention policy and the audit trail an regulator would ask for first.",
    status: "submitted",
    order: 2,
    history: [],
  },
  {
    key: "proposed",
    title: "Merchant settlement dashboard",
    description: "Per-merchant view of settled, pending and disputed volume.",
    status: "proposed",
    order: 3,
    history: [],
  },
];

/** Cards for the board. `milestone` refers to a key above; null is deliberate. */
const TASKS = [
  { title: "Benchmark settlement fees across corridors", status: "done", priority: "medium", milestone: "approved", assignee: 0 },
  { title: "Draft the partner shortlist memo", status: "done", priority: "low", milestone: "approved", assignee: 1 },
  { title: "Nightly ledger export parser", status: "done", priority: "high", milestone: "rejectThenApprove", assignee: 0 },
  { title: "Discrepancy report format", status: "done", priority: "medium", milestone: "rejectThenApprove", assignee: 2 },
  { title: "Repoint the reconciliation job at production", status: "done", priority: "urgent", milestone: "rejectThenApprove", assignee: 0 },
  { title: "KYC flow walkthrough", status: "in_progress", priority: "high", milestone: "submitted", assignee: 1 },
  { title: "Retention policy draft", status: "in_progress", priority: "medium", milestone: "submitted", assignee: 2 },
  { title: "Audit trail export", status: "in_progress", priority: "high", milestone: "submitted", assignee: 0 },
  { title: "Dashboard wireframes", status: "todo", priority: "medium", milestone: "proposed", assignee: 1 },
  { title: "Dispute state machine", status: "todo", priority: "low", milestone: "proposed", assignee: null },
  { title: "Write the quarterly funder update", status: "todo", priority: "low", milestone: null, assignee: null },
];

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */

/** Minimal `.env.local` reader — no dependency, and it only needs two keys. */
function loadEnv() {
  const path = join(HERE, "..", "..", ".env.local");
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !secret) {
  console.error(
    "Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (in the environment or web/.env.local).",
  );
  process.exit(1);
}

const db = createClient(url, secret, { auth: { persistSession: false } });

const clean = process.argv.includes("--clean");

/* -------------------------------------------------------------------------- */
/* Clean                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Deleting the project cascades to its milestones, tasks, anchors, reviews and
 * notifications — every foreign key to it is `on delete cascade`. The accounts
 * are separate and go afterwards, so a half-finished clean leaves orphaned
 * accounts rather than a project pointing at deleted owners.
 */
async function removeAll() {
  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("slug", PROJECT_SLUG)
    .maybeSingle();

  if (project) {
    const { error } = await db.from("projects").delete().eq("id", project.id);
    if (error) throw new Error(`deleting project: ${error.message}`);
    console.log(`Deleted project ${PROJECT_SLUG} and everything under it.`);
  } else {
    console.log(`No project ${PROJECT_SLUG} to delete.`);
  }

  // `listUsers` is paginated; the demo cohort is small enough for one page, and
  // a filter here is cheaper than being clever about it.
  const { data: users, error } = await db.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`listing users: ${error.message}`);

  const demo = users.users.filter((user) => user.email?.endsWith(EMAIL_DOMAIN));

  for (const user of demo) {
    const { error: deleteError } = await db.auth.admin.deleteUser(user.id);
    if (deleteError) console.warn(`  ! ${user.email}: ${deleteError.message}`);
  }

  console.log(`Deleted ${demo.length} demo account(s).`);
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Creates the account if it is not already there.
 *
 * Mirrors `createWalletAccount()` in src/lib/auth/wallet-session.ts, including
 * the part that looks redundant: the wallet address is written to the profile
 * in a second step, because GoTrue inserts `auth.users` and fires
 * `handle_new_user()` *before* merging in the `app_metadata` this call passes.
 * The trigger therefore cannot see the address, and the profile comes back with
 * `wallet_address: null` until something sets it.
 *
 * `profiles_freeze_wallet_address` allows that write exactly once, while the
 * column is still null, so re-running this script never tries to change one.
 */
async function ensureAccount(wallet) {
  const { data: existing } = await db
    .from("profiles")
    .select("id, wallet_address")
    .eq("username", wallet.username)
    .maybeSingle();

  if (existing) return existing.id;

  const { data, error } = await db.auth.admin.createUser({
    email: wallet.email,
    // Never signed in with. Present because an account without a recovery
    // credential is redirected to /register, and a member row pointing at one
    // would be a member who cannot be looked at.
    password: `demo-${wallet.address.slice(-12)}`,
    email_confirm: true,
    app_metadata: { wallet_address: wallet.address },
    user_metadata: { username: wallet.username, full_name: wallet.displayName },
  });

  if (error || !data.user) throw new Error(`creating ${wallet.email}: ${error?.message}`);

  const { error: bindError } = await db
    .from("profiles")
    .update({ wallet_address: wallet.address })
    .eq("id", data.user.id);

  if (bindError) throw new Error(`binding wallet for ${wallet.email}: ${bindError.message}`);

  return data.user.id;
}

async function seed() {
  if (!existsSync(WALLETS)) {
    console.error("No wallets yet. Run: node scripts/demo/wallets.mjs --count 4");
    process.exit(1);
  }

  const wallets = JSON.parse(readFileSync(WALLETS, "utf8"));

  const { data: existing } = await db
    .from("projects")
    .select("id")
    .eq("slug", PROJECT_SLUG)
    .maybeSingle();

  if (existing) {
    console.log(`Project ${PROJECT_SLUG} already exists. Run with --clean first to rebuild.`);
    process.exit(0);
  }

  // Accounts first: the project's owner is one of them, and `handle_new_project`
  // writes the owner's membership row from it.
  const ids = [];
  for (const wallet of wallets) {
    const id = await ensureAccount(wallet);
    ids.push(id);
    console.log(`account  ${wallet.displayName} (${wallet.username})`);
  }

  const { data: project, error: projectError } = await db
    .from("projects")
    .insert({ ...PROJECT, owner_id: ids[0] })
    .select("id")
    .single();

  if (projectError) throw new Error(`creating project: ${projectError.message}`);
  console.log(`project  ${PROJECT.name}`);

  // The owner's row is written by `handle_new_project`; the rest are ours.
  const others = wallets
    .map((wallet, index) => ({ project_id: project.id, user_id: ids[index], role: wallet.role }))
    .slice(1);

  if (others.length > 0) {
    const { error } = await db.from("project_members").insert(others);
    if (error) throw new Error(`adding members: ${error.message}`);
    console.log(`members  ${others.length} added, plus the owner`);
  }

  /*
    Milestones are inserted at their *starting* status and moved afterwards, one
    transition at a time. Inserting them at their final status would produce a
    workspace with no history at all — no reviews, and no notifications, because
    `notify_milestone_status()` only fires on an update.
  */
  const milestoneIds = {};

  for (const milestone of MILESTONES) {
    const start = milestone.history.length > 0 ? milestone.history[0].from : milestone.status;

    const { data, error } = await db
      .from("milestones")
      .insert({
        project_id: project.id,
        title: milestone.title,
        description: milestone.description,
        status: start,
        order_index: milestone.order,
      })
      .select("id")
      .single();

    if (error) throw new Error(`creating milestone "${milestone.title}": ${error.message}`);

    milestoneIds[milestone.key] = data.id;

    for (const step of milestone.history) {
      const { error: moveError } = await db
        .from("milestones")
        .update({ status: step.to })
        .eq("id", data.id);

      if (moveError) throw new Error(`moving "${milestone.title}": ${moveError.message}`);

      const { error: reviewError } = await db.from("milestone_reviews").insert({
        milestone_id: data.id,
        project_id: project.id,
        from_status: step.from,
        to_status: step.to,
        reason: step.reason,
        // The owner rules on submissions, matching the contract's auth check.
        reviewer_id: step.to === "submitted" ? ids[1] : ids[0],
      });

      if (reviewError) {
        throw new Error(`recording decision on "${milestone.title}": ${reviewError.message}`);
      }
    }

    console.log(
      `milestone ${milestone.title} — ${milestone.status}` +
        (milestone.history.length > 0 ? ` (${milestone.history.length} decisions)` : ""),
    );
  }

  const tasks = TASKS.map((task, index) => ({
    project_id: project.id,
    milestone_id: task.milestone ? milestoneIds[task.milestone] : null,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignee_id: task.assignee === null ? null : ids[task.assignee],
    order_index: index,
  }));

  const { error: taskError } = await db.from("tasks").insert(tasks);
  if (taskError) throw new Error(`creating tasks: ${taskError.message}`);
  console.log(`tasks    ${tasks.length}`);

  const { count } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  console.log(`\nSeeded. ${count ?? 0} notifications written by the trigger.`);
  console.log(`Open /projects/${PROJECT_SLUG} — and turn on Public proofs before recording.`);
  console.log(`\nThese accounts are scenery. Do not count them as users.`);
}

/* -------------------------------------------------------------------------- */

try {
  await (clean ? removeAll() : seed());
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
