import { z } from "zod";

import type { ActionState } from "@/lib/actions";

/**
 * The hackathon management page (WP-4.7, QDIT-56): the form's rules, the
 * Manila-time conversion and the RPC errors in plain words. Pure, so it is
 * shared by the dialog and the server actions and tested without either.
 */

/** Asia/Manila has no daylight saving: always UTC+8. */
export const MANILA_OFFSET = "+08:00";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A `datetime-local` value read as Manila time, as an ISO instant; null when it is not one. */
export function manilaInputToIso(value: string): string | null {
  const m = LOCAL_INPUT.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${MANILA_OFFSET}`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  // Date.parse rolls 2026-02-30 over to March: refuse what does not round-trip.
  return isoToManilaInput(new Date(ms).toISOString()) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` ? new Date(ms).toISOString() : null;
}

/** An instant as the `datetime-local` value a Manila clock shows; "" when unreadable. */
export function isoToManilaInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 16);
}

export const SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;
/** `/hackathons/manage` is this page; a hackathon there could never be opened. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["manage"]);

export type HackathonFields = {
  slug: string;
  name: string;
  description: string | null;
  opensAt: string;
  closesAt: string;
  teamMin: number;
  teamMax: number;
  finalistCount: number;
  hidden: boolean;
};

const whole = (label: string, min: number, max: number) =>
  z.coerce
    .number({ message: `Enter ${label}.` })
    .int(`Enter ${label} as a whole number.`)
    .min(min, `${label[0].toUpperCase()}${label.slice(1)} is at least ${min}.`)
    .max(max, `${label[0].toUpperCase()}${label.slice(1)} is at most ${max}.`);

const instant = (label: string) =>
  z
    .string()
    .transform((value, ctx) => {
      const iso = manilaInputToIso(value);
      if (!iso) ctx.addIssue({ code: "custom", message: `Enter when it ${label}, in Manila time.` });
      return iso ?? "";
    });

/**
 * The New and Edit dialogs' fields, with the table's own checks repeated so
 * they show under the right field before the database is asked.
 */
export const hackathonFormSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_PATTERN, "Use 1–64 lowercase letters, digits and dashes.")
      .refine((slug) => !RESERVED_SLUGS.has(slug), "That address is taken by the management page. Pick another slug."),
    name: z.string().trim().min(1, "Enter a name.").max(200, "Keep the name to 200 characters."),
    description: z
      .string()
      .trim()
      .max(4000, "Keep the description to 4,000 characters.")
      .transform((v) => (v === "" ? null : v)),
    opensAt: instant("opens"),
    closesAt: instant("closes"),
    teamMin: whole("the smallest team size", 1, 20),
    teamMax: whole("the largest team size", 1, 20),
    finalistCount: whole("the number of finalists", 1, 10),
    hidden: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.opensAt && v.closesAt && Date.parse(v.closesAt) <= Date.parse(v.opensAt)) {
      ctx.addIssue({ code: "custom", path: ["closesAt"], message: "It has to close after it opens." });
    }
    if (v.teamMax < v.teamMin) {
      ctx.addIssue({ code: "custom", path: ["teamMax"], message: "The largest team can't be smaller than the smallest." });
    }
  });

/** Reads the dialog's fields out of `FormData`. Never throws. */
export function readHackathonForm(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    slug: text("slug"),
    name: text("name"),
    description: text("description"),
    opensAt: text("opensAt"),
    closesAt: text("closesAt"),
    teamMin: text("teamMin"),
    teamMax: text("teamMax"),
    finalistCount: text("finalistCount"),
    hidden: formData.get("hidden") === "on" || formData.get("hidden") === "true",
  };
}

/** The RPC arguments both `create_hackathon` and `update_hackathon` take. */
export function rpcFields(f: HackathonFields) {
  return {
    p_slug: f.slug,
    p_name: f.name,
    p_description: f.description,
    p_opens_at: f.opensAt,
    p_closes_at: f.closesAt,
    p_team_min: f.teamMin,
    p_team_max: f.teamMax,
    p_finalist_count: f.finalistCount,
    p_hidden: f.hidden,
  };
}

export type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

/** A table check's constraint name, as Postgres puts it in the message, to the field it is about. */
const CHECK_FIELD: [RegExp, string, string][] = [
  [/hackathons_slug_check/, "slug", "Use 1–64 lowercase letters, digits and dashes."],
  [/hackathons_name_check/, "name", "Enter a name of up to 200 characters."],
  [/hackathons_description_check/, "description", "Keep the description to 4,000 characters."],
  [/hackathons_window/, "closesAt", "It has to close after it opens."],
  [/hackathons_team_min_check/, "teamMin", "The smallest team is at least 1."],
  [/hackathons_team_bounds/, "teamMax", "The largest team is between the smallest and 20."],
  [/hackathons_finalist_count_check/, "finalistCount", "Choose 1 to 10 finalists."],
];

/** `create_hackathon` / `update_hackathon` / `delete_hackathon` errors, in plain words. */
export function manageErrorState(error: PostgrestLikeError): ActionState {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "42501") return { error: message || "You can't change this hackathon." };
  if (code === "P0002") return { error: "That hackathon no longer exists." };
  if (code === "23505") return { fieldErrors: { slug: "Another hackathon already uses this slug." } };
  if (code === "23514") {
    const hit = CHECK_FIELD.find(([re]) => re.test(message));
    if (hit) return { fieldErrors: { [hit[1]]: hit[2] } };
  }
  if (code === "QD409") {
    if (message === "slug_locked") {
      return {
        fieldErrors: {
          slug: "Teams have already sent work to this hackathon, and doqtri finds it by its slug, so the slug stays.",
        },
      };
    }
    if (message === "slug_reserved") {
      return { fieldErrors: { slug: "That address is taken by the management page. Pick another slug." } };
    }
    if (message === "released_locked") {
      return { error: "Grades are released, so the dates, team size and number of finalists stay as they were." };
    }
    if (message === "hackathon_not_empty") {
      return { error: "Teams have sent work to this hackathon, so it can't be deleted. Hide it instead." };
    }
  }
  return { error: "That didn't go through. Try again in a moment." };
}

/** Why Delete is not offered on a row, or null when it is. */
export function deleteBlockedReason(row: { entries: number; snapshots: number; canDelete: boolean }, isOperator: boolean): string | null {
  if (!isOperator) return "Only qdit operators can delete hackathons.";
  if (row.entries > 0 || row.snapshots > 0) {
    return "Teams have sent work to this hackathon, so it can't be deleted. Hide it instead.";
  }
  return row.canDelete ? null : "This hackathon can't be deleted.";
}
