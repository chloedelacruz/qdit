import { z } from "zod";

/**
 * `z.guid()`, not `z.uuid()`.
 *
 * Zod 4's `uuid()` enforces the RFC 9562 version and variant nibbles. Postgres'
 * `uuid` type does not — it accepts any 8-4-4-4-12 hex string, and the seeded
 * ids (`22222222-2222-...`) have a version nibble of 2, which is not a real RFC
 * version. Validating more strictly than the database rejects rows the database
 * is perfectly happy to store.
 */

/**
 * Input schemas, shared by the client form and the server action that receives
 * it. The client copy gives instant feedback; the server copy is the one that
 * actually protects the database, because a form can be bypassed.
 *
 * Constraints mirror the CHECK constraints in supabase/migrations so a value
 * that passes here does not then fail in Postgres with an opaque error.
 */

export const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  // Supabase's own minimum is 6; stating it here turns a 422 from the API into
  // an inline field error.
  password: z.string().min(6, "Password must be at least 6 characters."),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * `profiles.username` — the handle chosen when a wallet is registered.
 *
 * Lowercased here rather than merely rejected in upper case, because the
 * database stores lowercase only: `profiles_username_format` refuses anything
 * else, which is what lets a plain unique index be case-insensitive without a
 * citext extension (see 20260812235342_profile_username.sql §1). Someone typing
 * `Ada` means `ada` and should not be told off for it.
 *
 * The 3–30 bound and the character class mirror that CHECK exactly. A value
 * that passes here cannot fail in Postgres with an opaque error.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters.")
  .max(30, "Keep it under 30 characters.")
  .regex(/^[a-z0-9_]+$/, "Lowercase letters, numbers and underscores only.");

/**
 * Everything the registration screen collects.
 *
 * Not the wallet address, deliberately — it comes from the signed ticket the
 * browser is holding, never from the form. The same rule the verify route
 * follows when it reads the address out of the transaction the signature covers
 * rather than off the request body: a field the caller controls could disagree
 * with what was proved, and then the server has to pick a side.
 */
export const walletRegistrationSchema = credentialsSchema.extend({
  username: usernameSchema,
});

export type WalletRegistration = z.infer<typeof walletRegistrationSchema>;

/** `projects.slug` — `^[a-z0-9]+(?:-[a-z0-9]+)*$`, globally unique. */
export const slugSchema = z
  .string()
  .min(1, "Required.")
  .max(80, "Keep it under 80 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Lowercase letters, numbers and single hyphens only.",
  );

export const projectSchema = z.object({
  // char_length(btrim(name)) between 1 and 200
  name: z.string().trim().min(1, "Required.").max(200, "Keep it under 200 characters."),
  slug: slugSchema,
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  status: z.enum(["active", "paused", "completed", "archived"]).default("active"),
  repoUrl: z.url("Enter a valid URL.").optional().or(z.literal("")),
  demoUrl: z.url("Enter a valid URL.").optional().or(z.literal("")),
  docsUrl: z.url("Enter a valid URL.").optional().or(z.literal("")),
});

/**
 * The slug is fixed after creation. It is `unique` and appears in every project
 * URL, so editing it would silently break links people have already shared.
 * Omitted from the schema rather than merely disabled in the form, so a
 * hand-made POST cannot set it either.
 */
export const projectUpdateSchema = projectSchema.omit({ slug: true });

export const taskSchema = z.object({
  projectId: z.guid(),
  // char_length(btrim(title)) between 1 and 300
  title: z.string().trim().min(1, "Required.").max(300, "Keep it under 300 characters."),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  // `not null default 'medium'` in Postgres, so the default is stated here too
  // rather than left to the column — a form that omits the field must still
  // produce a legal value for the update path, which sends every column.
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  milestoneId: z.guid().optional().or(z.literal("")),
  assigneeId: z.guid().optional().or(z.literal("")),
  dueDate: z.iso.date("Use YYYY-MM-DD.").optional().or(z.literal("")),
});

export const milestoneSchema = z.object({
  projectId: z.guid(),
  title: z.string().trim().min(1, "Required.").max(300, "Keep it under 300 characters."),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  status: z.enum(["proposed", "submitted", "approved", "rejected"]).default("proposed"),
  dueDate: z.iso.date("Use YYYY-MM-DD.").optional().or(z.literal("")),
});

/**
 * Mirrors the `stellar_proofs_has_evidence` CHECK: a proof with no contract id,
 * no tx hash and no URL proves nothing, so the form refuses it rather than
 * letting Postgres reject the insert.
 */
export const proofSchema = z
  .object({
    projectId: z.guid(),
    milestoneId: z.guid().optional().or(z.literal("")),
    contractId: z
      .string()
      .trim()
      .regex(/^C[A-Z2-7]{55}$/, "Contract IDs start with C and are 56 characters.")
      .optional()
      .or(z.literal("")),
    txHash: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/i, "A transaction hash is 64 hex characters.")
      .optional()
      .or(z.literal("")),
    network: z.enum(["testnet", "mainnet"]).default("testnet"),
    // Account strkeys: 56 chars starting with G. Same shape isWalletAddress()
    // enforces in stellar.ts — stated here so the form reports it inline.
    walletAddress: z
      .string()
      .trim()
      .regex(/^G[A-Z2-7]{55}$/, "Wallet addresses start with G and are 56 characters.")
      .optional()
      .or(z.literal("")),
    proofUrl: z.url("Enter a valid URL.").optional().or(z.literal("")),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine(
    (value) => Boolean(value.contractId || value.txHash || value.proofUrl),
    {
      message: "Add a contract ID, a transaction hash or a proof link.",
      path: ["contractId"],
    },
  );

/**
 * Mirrors the `deployments_network_required` CHECK: anything past 'not_started'
 * happened on some network, so it has to say which. Stated here as well so the
 * form reports it on the network field instead of surfacing a 23514.
 */
export const deploymentSchema = z
  .object({
    projectId: z.guid(),
    status: z
      .enum(["not_started", "testnet", "ready_for_mainnet", "mainnet_live"])
      .default("not_started"),
    network: z.enum(["testnet", "mainnet"]).optional().or(z.literal("")),
    contractId: z
      .string()
      .trim()
      .regex(/^C[A-Z2-7]{55}$/, "Contract IDs start with C and are 56 characters.")
      .optional()
      .or(z.literal("")),
    txHash: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/i, "A transaction hash is 64 hex characters.")
      .optional()
      .or(z.literal("")),
    releaseNotes: z.string().trim().max(4000).optional().or(z.literal("")),
  })
  .refine((value) => value.status === "not_started" || Boolean(value.network), {
    message: "Pick the network this was deployed to.",
    path: ["network"],
  });

/**
 * `profiles.display_name` and `profiles.wallet_address`. The wallet address is
 * the join between a Supabase user and a Stellar account — the contract
 * authenticates an `Address`, the app authenticates a user, and this is what
 * connects them.
 */
export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Required.")
    .max(120, "Keep it under 120 characters."),
  walletAddress: z
    .string()
    .trim()
    .regex(/^G[A-Z2-7]{55}$/, "Wallet addresses start with G and are 56 characters.")
    .optional()
    .or(z.literal("")),
});

/**
 * `project_members`. One row is a person plus what they may do in one project.
 *
 * `owner` is deliberately absent from the assignable roles. The owner row is
 * written by the `on_project_created` trigger and mirrors `projects.owner_id`,
 * which is what `projects: delete as owner` and the contract's
 * `approver == owner` check both key off. Handing `owner` out here would leave
 * a project with two of them and only one recorded on `projects`. Transferring
 * ownership is a different operation from managing a team, so it is not on this
 * form — and omitting it from the schema means a hand-made POST cannot set it
 * either.
 */
export const ASSIGNABLE_ROLES = ["admin", "member", "viewer"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const projectMemberSchema = z.object({
  projectId: z.guid(),
  userId: z.guid("Choose someone to add."),
  role: z.enum(ASSIGNABLE_ROLES),
});

/**
 * Adding someone who is not already a teammate.
 *
 * The identifier is resolved server-side by one of the three
 * `add_project_member_by_*` functions, because RLS makes a stranger's profile
 * invisible to every query this client is allowed to make. Validated here only
 * so an obvious typo is reported inline rather than after a round trip that
 * will say "no account uses that" and make the user wonder which of the two is
 * wrong.
 */
export const projectMemberIdentifierSchema = z.object({
  projectId: z.guid(),
  identifier: z.string().trim().min(1, "Required."),
  role: z.enum(ASSIGNABLE_ROLES),
});

export type ProjectMemberIdentifierInput = z.infer<typeof projectMemberIdentifierSchema>;

export type MemberIdentifier =
  | { kind: "wallet" | "email" | "username"; value: string }
  | { kind: "invalid"; message: string };

/** A Stellar account strkey: `G` and 55 more base32 characters. */
const WALLET_SHAPE = /^G[A-Z2-7]{55}$/;

/**
 * Works out which of the three things somebody typed.
 *
 * One field rather than three tabs, because the three formats cannot collide:
 * a username is `[a-z0-9_]{3,30}`, so it can hold no `@` and — uppercase being
 * forbidden by `profiles_username_format` — can never look like a `G…` address.
 * Making an admin declare which kind of identifier they hold before they may
 * paste it is a question they never need to be asked.
 *
 * Order matters, and only in one place: a 56-character string beginning with a
 * capital `G` is a wallet address someone got wrong, not a username that is far
 * too long. Reporting it as the former is the difference between "check the
 * address" and a sentence about underscores.
 */
export function classifyMemberIdentifier(raw: string): MemberIdentifier {
  const value = raw.trim();

  if (!value) return { kind: "invalid", message: "Required." };

  if (WALLET_SHAPE.test(value)) return { kind: "wallet", value };

  // Close enough to an address that it was meant to be one.
  if (value.length === 56 && value.startsWith("G")) {
    return {
      kind: "invalid",
      message: "Wallet addresses start with G and are 56 characters.",
    };
  }

  if (value.includes("@")) {
    const parsed = z.email().safeParse(value);
    return parsed.success
      ? { kind: "email", value: parsed.data }
      : { kind: "invalid", message: "Enter a valid email address." };
  }

  const parsed = usernameSchema.safeParse(value);
  return parsed.success
    ? { kind: "username", value: parsed.data }
    : {
        kind: "invalid",
        message:
          "Enter a username, an email address, or a wallet address starting with G.",
      };
}

export type ProjectInput = z.infer<typeof projectSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
export type MilestoneInput = z.infer<typeof milestoneSchema>;
export type ProofInput = z.infer<typeof proofSchema>;
export type DeploymentInput = z.infer<typeof deploymentSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type ProjectMemberInput = z.infer<typeof projectMemberSchema>;

/** Turns a name into a candidate slug, so the form can prefill it. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
