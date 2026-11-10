import type { ActionState } from "@/lib/actions";
import type { StellarNetwork } from "@/lib/stellar";
import {
  connectWallet,
  currentAddress,
  isRejectedError,
  isUnfundedError,
  signTransaction,
  walletNetwork,
  wrongNetworkMessage,
} from "@/lib/wallet";

/**
 * The browser half of `create_project_ref`: pick the signer, check its
 * network, prepare, sign, submit.
 *
 * There are two callers, and that is why this is its own module.
 *
 * - The **Register on chain** button on the project page registers a project
 *   that already exists.
 * - The create-project dialog registers one that doesn't exist yet. The wallet
 *   confirms first, and the project is created only once it has (QDIT-36).
 *
 * The walk through the wallet is the same for both, so it lives here once, and
 * each caller passes its own `prepare` and `submit`. Two copies would drift,
 * and the drift would show up as a project that registers from one place and
 * not the other.
 *
 * It returns an outcome instead of raising toasts, because the callers word the
 * result differently. On the project page a declined prompt says nothing,
 * since the button is still there. In the dialog it has to say that nothing
 * was created.
 *
 * A person still signs. The contract calls `owner.require_auth()`, and D-05
 * keeps every on-chain write except the D-16 revoker signed by a person.
 */
export type RegistrationSteps = {
  /** Build the unsigned transaction for this signer. */
  prepare: (
    signer: string,
  ) => Promise<{ ok: true; data: { xdr: string } } | { ok: false; error: string }>;
  /** Send the signed transaction and record what came of it. */
  submit: (signedXdr: string) => Promise<ActionState>;
};

export type RegistrationStage = "wallet" | "submitting";

export type RegistrationOutcome =
  /** The server took the signed transaction. Its own result says how it went. */
  | { kind: "submitted"; result: ActionState }
  | { kind: "wrong_network"; message: string }
  /** The person closed the chooser or the signing prompt. */
  | { kind: "declined" }
  /** The signing account has no entry on the network, so it can't pay a fee. */
  | { kind: "unfunded"; address: string | null }
  | { kind: "error"; message: string };

export async function runRegistration(
  network: StellarNetwork,
  steps: RegistrationSteps,
  options: {
    /**
     * Where to render the wallet chooser, if one is needed. Inside an open
     * dialog this has to be an element in the dialog. The kit's default is a
     * fixed overlay on <body>, and a modal dialog turns off pointer events
     * outside itself, so that overlay can't be clicked.
     */
    chooserContainer?: HTMLElement;
    /** Called as the walk moves on, for a caller that labels its button. */
    onStage?: (stage: RegistrationStage) => void;
  } = {},
): Promise<RegistrationOutcome> {
  try {
    options.onStage?.("wallet");

    // With nothing connected, always the chooser. Albedo and xBull need no
    // extension, so a browser with none installed can still sign, and closing
    // the chooser is the way out.
    const signer = (await currentAddress()) ?? (await connectWallet(options.chooserContainer));

    // A wallet on the wrong network fails with an error about a missing
    // account, which explains nothing. Ask before building anything.
    const walletOn = await walletNetwork();
    if (walletOn !== undefined && walletOn !== network) {
      return { kind: "wrong_network", message: wrongNetworkMessage(walletOn) };
    }

    const prepared = await steps.prepare(signer);
    if (!prepared.ok) {
      // The simulation is where a missing account actually shows up, and the
      // server returns it rather than throwing, so the catch below never sees
      // it (QDIT-59).
      if (isUnfundedError(prepared.error)) return { kind: "unfunded", address: signer };
      return { kind: "error", message: prepared.error };
    }

    const signed = await signTransaction(prepared.data.xdr);

    options.onStage?.("submitting");
    return { kind: "submitted", result: await steps.submit(signed) };
  } catch (caught) {
    const message = messageOf(caught);
    if (isRejectedError(message)) return { kind: "declined" };
    if (isUnfundedError(message)) {
      return { kind: "unfunded", address: (await currentAddress()) ?? null };
    }
    return { kind: "error", message };
  }
}

/**
 * The text of whatever was thrown. The wallet kit rejects with a plain
 * `{ code, message }` object, not an Error, so `String()` alone would turn
 * "The user closed the modal." into "[object Object]" and miss the decline.
 */
function messageOf(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === "object" && caught !== null && "message" in caught) {
    return String((caught as { message: unknown }).message);
  }
  return String(caught);
}
