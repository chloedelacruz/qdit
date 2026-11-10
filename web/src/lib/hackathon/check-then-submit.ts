import type { ActionState } from "@/lib/actions";

/** The form field "Submit anyway" sends; any other submit runs the check first. */
export const SUBMIT_ANYWAY = "submitAnyway";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * The submission dialog's decision (WP-4.7, QDIT-55):
 *
 *   - "Submit anyway" skips the check;
 *   - every item met: submit at once;
 *   - an item not met or unchecked: hand the checklist back to show;
 *   - field errors: hand them back (submit would give the same ones);
 *   - the check itself failed (no checklist, no field errors): submit, never
 *     block. Submit re-checks everything that matters and gives the
 *     authoritative error if there is one, so a broken preview cannot keep a
 *     team from submitting.
 */
export async function checkThenSubmit(
  prev: ActionState,
  formData: FormData,
  actions: { check: Action; submit: Action },
): Promise<ActionState> {
  if (formData.get(SUBMIT_ANYWAY) !== "1") {
    const checked = await actions.check(prev, formData);
    if (checked.entryCheck ? !checked.entryCheck.allPassed : checked.fieldErrors) return checked;
  }
  formData.delete(SUBMIT_ANYWAY);
  return actions.submit(prev, formData);
}
