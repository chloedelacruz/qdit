import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { expect, type Page } from "@playwright/test";

/**
 * A wallet for specs that sign, with no extension installed.
 *
 * Moved out of `wallet.spec.ts` so the project-registration spec can share it
 * (QDIT-36). How it works is explained at the top of that spec: a Hana
 * provider is put on `window` before any page script runs, and a keypair in
 * Node signs whatever it is handed.
 */

const FRIENDBOT = "https://friendbot.stellar.org";

export async function giveWallet(page: Page, keypair: Keypair): Promise<void> {
  await page.exposeFunction(
    "__e2eSignTransaction",
    (xdr: string, passphrase: string | undefined): string => {
      if (passphrase && passphrase !== Networks.TESTNET) {
        throw new Error(`e2e wallet signs on Testnet only, not "${passphrase}".`);
      }
      const transaction = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      transaction.sign(keypair);
      return transaction.toXDR();
    },
  );

  await page.addInitScript((address: string) => {
    // Looked up at call time, not here: the binding is installed by its own
    // init script, and the order of the two is not worth depending on.
    const sign = (xdr: string, passphrase?: string) =>
      (window as unknown as {
        __e2eSignTransaction: (xdr: string, passphrase?: string) => Promise<string>;
      }).__e2eSignTransaction(xdr, passphrase);

    (window as unknown as { hanaWallet: unknown }).hanaWallet = {
      stellar: {
        getPublicKey: async () => address,
        signTransaction: async ({
          xdr,
          networkPassphrase,
        }: {
          xdr: string;
          networkPassphrase?: string;
        }) => sign(xdr, networkPassphrase),
        signAuthEntry: async () => {
          throw new Error("e2e wallet does not sign auth entries.");
        },
        signMessage: async () => {
          throw new Error("e2e wallet does not sign messages.");
        },
      },
    };
  }, keypair.publicKey());
}

export async function connect(page: Page): Promise<void> {
  await page.goto("/wallet");
  await expect(page.getByRole("heading", { level: 1, name: "Wallet" })).toBeVisible();

  await page.getByRole("button", { name: "Connect wallet" }).click();
  // The kit's chooser is plain DOM appended to <body>, one <li> per wallet.
  await page.locator("li", { hasText: "Hana Wallet" }).click();
}

export async function fund(address: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT}?addr=${address}`, {
    signal: AbortSignal.timeout(30_000),
  });
  expect(response.ok, `Friendbot refused ${address}: ${await response.text()}`).toBe(true);
}
