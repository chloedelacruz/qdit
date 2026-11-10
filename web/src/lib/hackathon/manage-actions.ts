"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/actions";
import { hackathonFormSchema, manageErrorState, readHackathonForm, rpcFields } from "@/lib/hackathon/manage";
import { fieldErrorsOf } from "@/lib/schemas";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * The hackathon management page's writes (WP-4.7, QDIT-56). Each one is a
 * single RPC that checks session and role itself (operators create and
 * delete; operators and the hackathon's admins edit and hide), so these only
 * validate, call and refresh.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh() {
  // The index, every event page and the banner in the layout.
  revalidatePath("/hackathons", "layout");
  revalidatePath("/", "layout");
}

export async function createHackathon(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await getUser())) return { error: "Sign in first." };
  const parsed = hackathonFormSchema.safeParse(readHackathonForm(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_hackathon", rpcFields(parsed.data));
  if (error) return manageErrorState(error);

  refresh();
  return { ok: true, id: typeof data === "string" ? data : undefined };
}

export async function updateHackathon(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await getUser())) return { error: "Sign in first." };
  const id = formData.get("id");
  if (typeof id !== "string" || !ID.test(id)) return { error: "That hackathon no longer exists." };
  const parsed = hackathonFormSchema.safeParse(readHackathonForm(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_hackathon", { p_id: id, ...rpcFields(parsed.data) });
  if (error) return manageErrorState(error);

  refresh();
  return { ok: true };
}

/** Hide or unhide: the row as it stands, with `hidden` flipped. */
export async function setHackathonHidden(id: string, hidden: boolean): Promise<ActionState> {
  if (!(await getUser())) return { error: "Sign in first." };
  if (!ID.test(id)) return { error: "That hackathon no longer exists." };

  const supabase = await createClient();
  const { data: h, error: readError } = await supabase
    .from("hackathons")
    .select("slug, name, description, opens_at, closes_at, team_min, team_max, finalist_count")
    .eq("id", id)
    .maybeSingle();
  if (readError || !h) return { error: "That hackathon no longer exists." };

  const { error } = await supabase.rpc("update_hackathon", {
    p_id: id,
    p_slug: h.slug,
    p_name: h.name,
    p_description: h.description,
    p_opens_at: h.opens_at,
    p_closes_at: h.closes_at,
    p_team_min: h.team_min,
    p_team_max: h.team_max,
    p_finalist_count: h.finalist_count,
    p_hidden: hidden,
  });
  if (error) return manageErrorState(error);

  refresh();
  return { ok: true };
}

export async function deleteHackathon(id: string): Promise<ActionState> {
  if (!(await getUser())) return { error: "Sign in first." };
  if (!ID.test(id)) return { error: "That hackathon no longer exists." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_hackathon", { p_id: id });
  if (error) return manageErrorState(error);

  refresh();
  return { ok: true };
}
