import { describe, expect, it } from "vitest";

import { anyWalletInstalled } from "./wallet";

/**
 * The login page's first setup step reads this. The kit reports Albedo, xBull
 * and GHOSTSIG as available in every browser, so counting them meant the step
 * always said a wallet was found (QDIT-39).
 */
const wallet = (id: string, isAvailable: boolean) => ({ id, isAvailable });

describe("anyWalletInstalled", () => {
  it("does not count wallets that need no extension", () => {
    expect(
      anyWalletInstalled([
        wallet("albedo", true),
        wallet("xbull", true),
        wallet("ghostsig", true),
        wallet("varial", false),
      ]),
    ).toBe(false);
  });

  it("counts an extension that is present", () => {
    expect(anyWalletInstalled([wallet("albedo", true), wallet("varial", true)])).toBe(true);
    expect(anyWalletInstalled([wallet("hana", true)])).toBe(true);
  });

  it("does not count an extension that is absent, or an empty list", () => {
    expect(anyWalletInstalled([wallet("varial", false)])).toBe(false);
    expect(anyWalletInstalled([])).toBe(false);
  });
});
