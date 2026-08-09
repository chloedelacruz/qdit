"use client";

/**
 * Wallet access, for signing milestone anchors.
 *
 * The wallet is an **attestation key, not a login.** qdit authenticates with
 * Supabase email/password and derives permission from `project_members`;
 * connecting a wallet adds the ability to sign a transaction the contract will
 * accept. Nothing here touches the session, and `profiles.wallet_address` is a
 * convenience field — the signature on the transaction is what proves control
 * of the key, and the server reads the signer back out of the submitted
 * transaction rather than trusting the profile.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY IMPORT IS INSIDE A FUNCTION
 * ---------------------------------------------------------------------------
 * `@creit.tech/stellar-wallets-kit` reads `localStorage` during *module
 * evaluation*. `"use client"` does not mean "browser only" — Next still renders
 * client components on the server to produce the initial HTML — so a top-level
 * import crashes every route that reaches this module with
 * `localstorage?.getItem is not a function`.
 *
 * So: import inside each function, keep everything async, and keep the browser
 * check in the function body. Pure helpers stay out of that path entirely so
 * components can import them freely.
 */

const NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

let initialized = false;

type Kit = typeof import("@creit.tech/stellar-wallets-kit/sdk").StellarWalletsKit;

async function kit(): Promise<Kit | null> {
  if (typeof window === "undefined") return null;

  const [{ StellarWalletsKit }, { defaultModules }, types] = await Promise.all([
    import("@creit.tech/stellar-wallets-kit/sdk"),
    import("@creit.tech/stellar-wallets-kit/modules/utils"),
    import("@creit.tech/stellar-wallets-kit/types"),
  ]);

  if (!initialized) {
    StellarWalletsKit.init({
      modules: defaultModules(),
      // Pinned in one place. A wallet on the wrong network produces a signature
      // the RPC will reject, with an error that does not say why.
      network: NETWORK === "mainnet" ? types.Networks.PUBLIC : types.Networks.TESTNET,
      theme: prefersDark() ? types.SwkAppDarkTheme : types.SwkAppLightTheme,
    });
    initialized = true;
  } else {
    // next-themes can flip after init, and the modal outlives the first render.
    StellarWalletsKit.setTheme(
      prefersDark() ? types.SwkAppDarkTheme : types.SwkAppLightTheme,
    );
  }

  return StellarWalletsKit;
}

/** next-themes writes `class="dark"` on <html>; follow it rather than guess. */
function prefersDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** Opens the wallet chooser. Resolves with the connected address. */
export async function connectWallet(): Promise<string> {
  const wallets = await kit();
  if (!wallets) throw new Error("Connecting a wallet needs a browser.");

  const { address } = await wallets.authModal();
  return address;
}

export async function disconnectWallet(): Promise<void> {
  const wallets = await kit();
  await wallets?.disconnect();
}

/** The connected address, or undefined if no wallet is connected. */
export async function currentAddress(): Promise<string | undefined> {
  const wallets = await kit();
  if (!wallets) return undefined;

  try {
    const { address } = await wallets.getAddress();
    return address || undefined;
  } catch {
    // Not connected. The kit throws rather than returning empty.
    return undefined;
  }
}

/**
 * Signs a prepared transaction.
 *
 * Takes and returns base64 XDR — the wallet never sees the app's data, and the
 * server re-verifies what came back before submitting it.
 */
export async function signTransaction(xdr: string): Promise<string> {
  const [wallets, types] = await Promise.all([
    kit(),
    import("@creit.tech/stellar-wallets-kit/types"),
  ]);
  if (!wallets) throw new Error("Signing needs a browser.");

  const { signedTxXdr } = await wallets.signTransaction(xdr, {
    networkPassphrase:
      NETWORK === "mainnet" ? types.Networks.PUBLIC : types.Networks.TESTNET,
  });
  return signedTxXdr;
}

/** Subscribe to connect/disconnect. Returns an unsubscribe function. */
export async function onWalletState(
  callback: (address: string | undefined) => void,
): Promise<() => void> {
  const [wallets, types] = await Promise.all([
    kit(),
    import("@creit.tech/stellar-wallets-kit/types"),
  ]);
  if (!wallets) return () => {};

  return wallets.on(types.KitEventType.STATE_UPDATED, (event) => {
    callback(event.payload.address);
  });
}

/* -------------------------------------------------------------------------- */
/* Pure helpers — no kit, safe to import anywhere                             */
/* -------------------------------------------------------------------------- */

/** Testnet accounts must be funded before they can pay a fee. */
export function friendbotUrl(address: string): string {
  return `https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`;
}

/** True when the account has no entry on the network yet. */
export function isUnfundedError(message: string): boolean {
  return /not found|NotFound|account not found|op_no_source_account/i.test(message);
}

/** The user closed the wallet prompt. Not an error worth a red toast. */
export function isRejectedError(message: string): boolean {
  return /reject|denied|declin|cancel|user closed/i.test(message);
}
