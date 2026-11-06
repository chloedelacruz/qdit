import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The browser half of project registration (QDIT-36).
 *
 * Mocked: the wallet kit, and the caller's own `prepare` and `submit`. The
 * thing under test is the order of operations and how each failure maps to an
 * outcome. Each kind of outcome is checked once, because the create dialog and
 * the project page both read it and word it themselves.
 */

const wallet = {
  currentAddress: vi.fn<() => Promise<string | undefined>>(),
  connectWallet: vi.fn<(container?: HTMLElement) => Promise<string>>(),
  hasWalletInstalled: vi.fn<() => Promise<boolean>>(),
  walletNetwork: vi.fn<() => Promise<"testnet" | "mainnet" | null | undefined>>(),
  signTransaction: vi.fn<(xdr: string) => Promise<string>>(),
};
vi.mock("@/lib/wallet", async (importOriginal) => {
  // The pure helpers (error matchers, network message) stay real.
  const real = await importOriginal<typeof import("@/lib/wallet")>();
  return {
    ...real,
    currentAddress: () => wallet.currentAddress(),
    connectWallet: (container?: HTMLElement) => wallet.connectWallet(container),
    hasWalletInstalled: () => wallet.hasWalletInstalled(),
    walletNetwork: () => wallet.walletNetwork(),
    signTransaction: (xdr: string) => wallet.signTransaction(xdr),
  };
});

const { runRegistration } = await import("@/lib/chain/register-project");

const SIGNER = "GDQERENWDDSQZS7R7WKHZI3BSOYMV3FSWR7TFUYFTKQ447PIX6NREOJM";

const prepare = vi.fn();
const submit = vi.fn();
const steps = { prepare, submit };

beforeEach(() => {
  vi.resetAllMocks();
  wallet.currentAddress.mockResolvedValue(SIGNER);
  wallet.walletNetwork.mockResolvedValue("testnet");
  wallet.signTransaction.mockResolvedValue("SIGNED");
  prepare.mockResolvedValue({ ok: true, data: { xdr: "UNSIGNED" } });
  submit.mockResolvedValue({ ok: true });
});

describe("runRegistration", () => {
  it("prepares for the connected signer, signs that XDR, and submits it", async () => {
    await expect(runRegistration("testnet", steps)).resolves.toEqual({
      kind: "submitted",
      result: { ok: true },
    });

    expect(prepare).toHaveBeenCalledWith(SIGNER);
    expect(wallet.signTransaction).toHaveBeenCalledWith("UNSIGNED");
    expect(submit).toHaveBeenCalledWith("SIGNED");
    expect(wallet.connectWallet).not.toHaveBeenCalled();
  });

  it("hands the server's result back as it came, failures included", async () => {
    submit.mockResolvedValue({ fieldErrors: { slug: "That slug is taken." } });

    await expect(runRegistration("testnet", steps)).resolves.toEqual({
      kind: "submitted",
      result: { fieldErrors: { slug: "That slug is taken." } },
    });
  });

  it("reports the wallet stage first, and submitting only once signed", async () => {
    const stages: string[] = [];
    wallet.signTransaction.mockImplementation(async () => {
      stages.push("signed");
      return "SIGNED";
    });

    await runRegistration("testnet", steps, { onStage: (stage) => stages.push(stage) });

    expect(stages).toEqual(["wallet", "signed", "submitting"]);
  });

  it("opens the chooser in the given container when nothing is connected", async () => {
    wallet.currentAddress.mockResolvedValue(undefined);
    wallet.connectWallet.mockResolvedValue(SIGNER);
    const container = {} as HTMLElement;

    await expect(
      runRegistration("testnet", steps, { chooserContainer: container }),
    ).resolves.toMatchObject({ kind: "submitted" });
    expect(wallet.connectWallet).toHaveBeenCalledWith(container);
    // The project-page button never asked, and still doesn't.
    expect(wallet.hasWalletInstalled).not.toHaveBeenCalled();
  });

  it("with onlyIfWalletInstalled, opens the chooser when a wallet is installed", async () => {
    wallet.currentAddress.mockResolvedValue(undefined);
    wallet.hasWalletInstalled.mockResolvedValue(true);
    wallet.connectWallet.mockResolvedValue(SIGNER);

    const outcome = await runRegistration("testnet", steps, { onlyIfWalletInstalled: true });
    expect(outcome.kind).toBe("submitted");
    expect(wallet.connectWallet).toHaveBeenCalledOnce();
  });

  it("with onlyIfWalletInstalled and no wallet, asks nothing and builds nothing", async () => {
    wallet.currentAddress.mockResolvedValue(undefined);
    wallet.hasWalletInstalled.mockResolvedValue(false);

    const outcome = await runRegistration("testnet", steps, { onlyIfWalletInstalled: true });
    expect(outcome).toEqual({ kind: "no_wallet" });
    expect(wallet.connectWallet).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("stops before building when the wallet is on another network", async () => {
    wallet.walletNetwork.mockResolvedValue("mainnet");

    const outcome = await runRegistration("testnet", steps);
    expect(outcome.kind).toBe("wrong_network");
    expect(outcome.kind === "wrong_network" && outcome.message).toMatch(/Mainnet/i);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("treats an unknown wallet network as no objection", async () => {
    wallet.walletNetwork.mockResolvedValue(undefined);
    await expect(runRegistration("testnet", steps)).resolves.toMatchObject({
      kind: "submitted",
    });
  });

  it("passes a refused prepare through as an error, without a signing prompt", async () => {
    prepare.mockResolvedValue({ ok: false, error: "This project is already registered on chain." });

    await expect(runRegistration("testnet", steps)).resolves.toEqual({
      kind: "error",
      message: "This project is already registered on chain.",
    });
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("reports a closed signing prompt as declined, and submits nothing", async () => {
    wallet.signTransaction.mockRejectedValue(new Error("User rejected the request"));

    await expect(runRegistration("testnet", steps)).resolves.toEqual({ kind: "declined" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("reports a closed chooser as declined", async () => {
    wallet.currentAddress.mockResolvedValue(undefined);
    wallet.connectWallet.mockRejectedValue(new Error("The user closed the modal"));

    await expect(runRegistration("testnet", steps)).resolves.toEqual({ kind: "declined" });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("reads the kit's plain-object rejection, not just an Error", async () => {
    wallet.currentAddress.mockResolvedValue(undefined);
    // What the kit's chooser rejects with when its close button is pressed.
    wallet.connectWallet.mockRejectedValue({ code: -1, message: "The user closed the modal." });

    await expect(runRegistration("testnet", steps)).resolves.toEqual({ kind: "declined" });
  });

  it("reports an unfunded account with the address to fund", async () => {
    wallet.signTransaction.mockRejectedValue(new Error("Account not found"));

    await expect(runRegistration("testnet", steps)).resolves.toEqual({
      kind: "unfunded",
      address: SIGNER,
    });
  });

  it("turns any other thrown failure into an error, never a throw", async () => {
    wallet.signTransaction.mockRejectedValue(new Error("RPC timed out"));

    await expect(runRegistration("testnet", steps)).resolves.toEqual({
      kind: "error",
      message: "RPC timed out",
    });
  });
});
