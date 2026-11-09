import type { ActionState } from "@/lib/actions";

/**
 * Which field errors the submit dialog still shows (QDIT-47).
 *
 * A failed submit returns field errors, and they describe the form as it was
 * sent. Once the person changes a field, its error no longer describes
 * anything: "Choose 3 to 4 team members." under three ticked boxes reads as a
 * bug. So a field's error is hidden from the moment that field changes, until
 * the next submit returns a fresh result.
 *
 * `edited` is tied to the result it was recorded against: a new result (a new
 * object from the action) starts with nothing edited.
 */
export type EditedFields = { result: ActionState; fields: ReadonlySet<string> };

export function noEdits(result: ActionState): EditedFields {
  return { result, fields: new Set() };
}

/** Records that `fields` changed since `result` came back. */
export function markEdited(
  previous: EditedFields,
  result: ActionState,
  ...fields: string[]
): EditedFields {
  const kept = previous.result === result ? previous.fields : new Set<string>();
  return { result, fields: new Set([...kept, ...fields]) };
}

/** The field errors of `result` for fields not changed since it came back. */
export function visibleFieldErrors(result: ActionState, edited: EditedFields): Record<string, string> {
  const errors = result.fieldErrors ?? {};
  if (edited.result !== result) return { ...errors };
  return Object.fromEntries(Object.entries(errors).filter(([field]) => !edited.fields.has(field)));
}
