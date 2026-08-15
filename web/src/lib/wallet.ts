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

import {
  HORIZON_URL,
  NETWORK_LABELS,
  networkFromPassphrase,
  type StellarNetwork,
} from "@/lib/stellar";

/** The network this deployment runs on. Everything below compares against it. */
export const APP_NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

const NETWORK = APP_NETWORK;

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

/**
 * Subscribe to connect/disconnect. Returns an unsubscribe function.
 *
 * The event carries the wallet's network passphrase alongside the address, so
 * switching network in the extension is a state change this hears about rather
 * than something the app has to poll for.
 */
export async function onWalletState(
  callback: (
    address: string | undefined,
    network: StellarNetwork | null | undefined,
  ) => void,
): Promise<() => void> {
  const [wallets, types] = await Promise.all([
    kit(),
    import("@creit.tech/stellar-wallets-kit/types"),
  ]);
  if (!wallets) return () => {};

  return wallets.on(types.KitEventType.STATE_UPDATED, (event) => {
    callback(
      event.payload.address,
      event.payload.networkPassphrase
        ? networkFromPassphrase(event.payload.networkPassphrase)
        : undefined,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Setup checks — what someone needs before any of the above works            */
/* -------------------------------------------------------------------------- */

/**
 * Is any wallet installed in this browser?
 *
 * The kit lists every wallet it knows about and marks the ones actually present
 * with `isAvailable`. Asked before connecting, so it can only report on wallets
 * that announce themselves to the page — an extension is one, a hardware wallet
 * behind a bridge is not. False therefore means "we cannot see one", which is
 * the same advice either way: install Freighter.
 */
export async function hasWalletInstalled(): Promise<boolean> {
  const wallets = await kit();
  if (!wallets) return false;

  try {
    const supported = await wallets.refreshSupportedWallets();
    return supported.some((wallet) => wallet.isAvailable);
  } catch {
    return false;
  }
}

/**
 * The network the connected wallet is on, as the wallet reports it.
 *
 * `undefined` means nothing is connected yet — not an error, just too early to
 * ask. `null` means it answered with a network qdit does not run on.
 *
 * This exists because of what it prevents. A wallet left on Mainnet does not
 * fail loudly: the account lookup comes back empty and the app used to say the
 * account did not exist, which reads as "the site is broken" rather than "you
 * are on the wrong network". Reading the passphrase turns that into a sentence
 * that names the fix.
 */
export async function walletNetwork(): Promise<StellarNetwork | null | undefined> {
  const wallets = await kit();
  if (!wallets) return undefined;

  try {
    const { networkPassphrase } = await wallets.getNetwork();
    return networkFromPassphrase(networkPassphrase);
  } catch {
    // Not connected, or the wallet declined to answer. Either way, unknown.
    return undefined;
  }
}

/**
 * True when the connected wallet is on a network this deployment cannot use.
 * Deliberately false while nothing is connected: an unknown network is not a
 * wrong one, and warning about it before someone has picked a wallet is noise.
 */
export async function isOnWrongNetwork(): Promise<boolean> {
  const network = await walletNetwork();
  return network !== undefined && network !== NETWORK;
}

/** The sentence to show when it is. Names both networks, and what to do. */
export function wrongNetworkMessage(found: StellarNetwork | null): string {
  const on = found ? NETWORK_LABELS[found] : "a network qdit does not use";
  return `Your wallet is on ${on}. qdit runs on ${NETWORK_LABELS[NETWORK]} — switch networks in your wallet, then try again.`;
}

/**
 * Does this account exist on the network yet?
 *
 * Straight to Horizon from the browser rather than through `/api/balance`,
 * because this question is asked on the sign-in page where there is no session
 * to authenticate with. Horizon is a public, CORS-enabled API and the address
 * is a public key, so nothing here is worth proxying — and proxying it would
 * turn the app into an open Horizon relay, which `/api/balance` exists to avoid.
 *
 * A network failure answers `undefined`, not `false`: "we could not tell" must
 * not render as "your account does not exist".
 */
export async function accountExists(
  address: string,
  network: StellarNetwork = NETWORK,
): Promise<boolean | undefined> {
  try {
    const response = await fetch(`${HORIZON_URL[network]}/accounts/${address}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 404) return false;
    if (!response.ok) return undefined;
    return true;
  } catch {
    return undefined;
  }
}

/**
 * Funds a Testnet account with Friendbot.
 *
 * Replaces the link that used to open Friendbot's raw JSON in a second tab and
 * leave people to work out whether it had worked. Throws with Friendbot's own
 * explanation when it refuses — most often because the account is already
 * funded, which is a state worth reporting rather than a failure.
 */
export async function fundTestnetAccount(address: string): Promise<void> {
  if (NETWORK !== "testnet") {
    throw new Error("Friendbot only funds Testnet accounts.");
  }

  let response: Response;
  try {
    response = await fetch(friendbotUrl(address), {
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Could not reach Friendbot. Try again in a moment.");
  }

  if (response.ok) return;

  // Friendbot answers with a Horizon problem document. `detail` is written for
  // a person; the status code is not.
  const problem = (await response.json().catch(() => ({}))) as {
    detail?: string;
    status?: number;
  };

  if (response.status === 400 && /exists|funded/i.test(problem.detail ?? "")) {
    throw new Error("This account is already funded.");
  }

  throw new Error(problem.detail ?? `Friendbot returned ${response.status}.`);
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
