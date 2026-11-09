/**
 * A synchronous one-at-a-time guard for a form submit.
 *
 * `useActionState` queues dispatches instead of dropping them, and `pending`
 * only disables the button on the next render, so a fast double click can
 * still send the same form twice. This flag flips in the click handler
 * itself, before React renders anything, and opens again when the action has
 * resolved. Used by `FormDialog` when a dialog opts in (`singleSubmit`).
 */
export type SubmitGate = {
  /** True, and closed, for the first caller; false while a submit is in flight. */
  enter(): boolean;
  release(): void;
  readonly busy: boolean;
};

export function createSubmitGate(): SubmitGate {
  let busy = false;
  return {
    enter() {
      if (busy) return false;
      busy = true;
      return true;
    },
    release() {
      busy = false;
    },
    get busy() {
      return busy;
    },
  };
}
