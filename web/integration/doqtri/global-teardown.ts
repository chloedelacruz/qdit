import { readEnv } from "./env";
import { NAME_PREFIX, SLUG_PREFIX, serviceRest } from "./rest";

/**
 * Sweeps what a crashed run left behind. Each spec deletes its own rows in
 * afterAll; this catches the rest by the prefixes every suite-made name
 * carries. The two test accounts stay: they are reused on the next run.
 */
export default async function globalTeardown(): Promise<void> {
  readEnv();

  const projects = await serviceRest<{ id: string }[]>("qdit", `projects?slug=like.${SLUG_PREFIX}*&select=id`);
  for (const { id } of projects) {
    await serviceRest("doqtri", `qdit_milestone_states?project_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(
      () => undefined,
    );
    await serviceRest("qdit", `projects?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  }

  const notes = await serviceRest<{ id: string }[]>(
    "doqtri",
    `documents?title=like.${encodeURIComponent(`${NAME_PREFIX} `)}*&select=id`,
  );
  for (const { id } of notes) {
    await serviceRest("doqtri", `doc_project_links?document_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
    await serviceRest("doqtri", `documents?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
  }
}
