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
});

export const taskSchema = z.object({
  projectId: z.guid(),
  // char_length(btrim(title)) between 1 and 300
  title: z.string().trim().min(1, "Required.").max(300, "Keep it under 300 characters."),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
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

export type ProjectInput = z.infer<typeof projectSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
export type MilestoneInput = z.infer<typeof milestoneSchema>;
export type ProofInput = z.infer<typeof proofSchema>;

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
