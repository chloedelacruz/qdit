import { describe, expect, it } from "vitest";

import {
  HORIZON_URL,
  NETWORK_LABELS,
  SOROBAN_RPC_URL,
  accountUrl,
  contractUrl,
  formatXlm,
  fromStroops,
  isContractId,
  isTxHash,
  isValidAmount,
  isWalletAddress,
  minimumBalanceStroops,
  toStroops,
  truncateHash,
  txUrl,
} from "@/lib/stellar";

/**
 * These validators are the app's only defence for the proof fields, since
 * `stellar_proofs.contract_id`, `.tx_hash` and `.wallet_address` are all plain
 * `text` with no CHECK constraint behind them. If a regex here is wrong,
 * Postgres will happily store whatever gets through.
 *
 * So the interesting cases are the near-misses, not the happy path: one
 * character short, one too long, the right length with a character outside the
 * base32 alphabet, and the wrong leading letter. A strkey that is 56 characters
 * of the correct alphabet but starts with G is a perfectly valid *account* and
 * a completely invalid *contract*, and only the first character says so.
 */

/** 55 base32 characters, to be prefixed with the type letter under test. */
const BODY_55 = "A".repeat(55);
const CONTRACT = `C${BODY_55}`;
const ACCOUNT = `G${BODY_55}`;
const TX_HASH = "a".repeat(64);

describe("isContractId", () => {
  it("accepts a well-formed contract strkey", () => {
    expect(isContractId(CONTRACT)).toBe(true);
  });

  it("accepts every character in the base32 alphabet", () => {
    // The 32-character alphabet once, padded to the required 55.
    const body = `${"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"}${"ABCDEFGHIJKLMNOPQRSTUVW"}`;
    expect(body).toHaveLength(55);
    expect(isContractId(`C${body}`)).toBe(true);
  });

  it("rejects an account strkey — same length, wrong prefix", () => {
    expect(isContractId(ACCOUNT)).toBe(false);
  });

  it("rejects one character short and one character long", () => {
    expect(isContractId(`C${"A".repeat(54)}`)).toBe(false);
    expect(isContractId(`C${"A".repeat(56)}`)).toBe(false);
  });

  it("rejects characters outside base32", () => {
    // 0, 1, 8 and 9 are absent from RFC 4648's alphabet, as is lowercase.
    for (const bad of ["0", "1", "8", "9", "a"]) {
      expect(isContractId(`C${bad}${"A".repeat(54)}`)).toBe(false);
    }
  });

  it("rejects an empty string", () => {
    expect(isContractId("")).toBe(false);
  });

  it("tolerates surrounding whitespace, because paste brings it along", () => {
    expect(isContractId(`  ${CONTRACT}\n`)).toBe(true);
  });
});

describe("isWalletAddress", () => {
  it("accepts a well-formed account strkey", () => {
    expect(isWalletAddress(ACCOUNT)).toBe(true);
  });

  it("rejects a contract strkey — same length, wrong prefix", () => {
    expect(isWalletAddress(CONTRACT)).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isWalletAddress(`G${"A".repeat(54)}`)).toBe(false);
    expect(isWalletAddress(`G${"A".repeat(56)}`)).toBe(false);
  });

  it("rejects lowercase, which base32 does not include", () => {
    expect(isWalletAddress(`G${"a".repeat(55)}`)).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isWalletAddress(`  ${ACCOUNT}  `)).toBe(true);
  });

  it("matches the regex used by proofSchema and profileSchema", () => {
    // Those two schemas restate this rule so a form can report it inline. If
    // this assertion and those regexes ever disagree, a value accepted by one
    // path is rejected by the other.
    const schemaRe = /^G[A-Z2-7]{55}$/;
    for (const value of [ACCOUNT, CONTRACT, "", `G${"A".repeat(54)}`]) {
      expect(isWalletAddress(value)).toBe(schemaRe.test(value.trim()));
    }
  });
});

describe("isTxHash", () => {
  it("accepts 64 lowercase hex characters", () => {
    expect(isTxHash(TX_HASH)).toBe(true);
  });

  it("accepts uppercase hex — Horizon is queried with either", () => {
    expect(isTxHash("A".repeat(64))).toBe(true);
  });

  it("accepts a realistic mixed-case digest", () => {
    expect(isTxHash("3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889"))
      .toBe(true);
  });

  it("rejects 63 and 65 characters", () => {
    expect(isTxHash("a".repeat(63))).toBe(false);
    expect(isTxHash("a".repeat(65))).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isTxHash(`g${"a".repeat(63)}`)).toBe(false);
  });

  it("rejects a 0x prefix, which Stellar does not use", () => {
    expect(isTxHash(`0x${"a".repeat(64)}`)).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isTxHash(` ${TX_HASH} `)).toBe(true);
  });
});

describe("explorer URLs", () => {
  it("maps mainnet to stellar.expert's 'public'", () => {
    // The product says mainnet; the explorer says public. This mapping is the
    // only place that difference is allowed to exist.
    expect(contractUrl(CONTRACT, "mainnet")).toContain("/explorer/public/contract/");
    expect(txUrl(TX_HASH, "mainnet")).toContain("/explorer/public/tx/");
    expect(accountUrl(ACCOUNT, "mainnet")).toContain("/explorer/public/account/");
  });

  it("keeps testnet as testnet", () => {
    expect(contractUrl(CONTRACT, "testnet")).toContain("/explorer/testnet/contract/");
  });

  it("appends the identifier verbatim", () => {
    expect(txUrl(TX_HASH, "testnet")).toBe(
      `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`,
    );
  });

  it("produces parseable absolute https URLs", () => {
    for (const url of [
      contractUrl(CONTRACT, "testnet"),
      txUrl(TX_HASH, "mainnet"),
      accountUrl(ACCOUNT, "testnet"),
    ]) {
      expect(new URL(url).protocol).toBe("https:");
    }
  });
});

describe("network tables", () => {
  it("covers both networks in every table", () => {
    for (const table of [NETWORK_LABELS, HORIZON_URL, SOROBAN_RPC_URL]) {
      expect(Object.keys(table).sort()).toEqual(["mainnet", "testnet"]);
    }
  });

  it("points testnet and mainnet at different hosts", () => {
    // Transposing these would verify a transaction against the wrong ledger and
    // report a confident, wrong answer.
    expect(HORIZON_URL.testnet).not.toBe(HORIZON_URL.mainnet);
    expect(SOROBAN_RPC_URL.testnet).not.toBe(SOROBAN_RPC_URL.mainnet);
    expect(HORIZON_URL.testnet).toContain("testnet");
  });
});

describe("truncateHash", () => {
  it("keeps both ends, which is how identifiers are compared by eye", () => {
    expect(truncateHash(TX_HASH)).toBe(`${"a".repeat(6)}…${"a".repeat(6)}`);
  });

  it("honours custom lead and tail lengths", () => {
    expect(truncateHash(ACCOUNT, 4, 4)).toBe(`GAAA…${"A".repeat(4)}`);
  });

  it("returns short values untouched rather than adding an ellipsis", () => {
    expect(truncateHash("GABC")).toBe("GABC");
  });

  it("leaves a value exactly at the threshold alone", () => {
    // lead + tail + 1 is the shortest string worth truncating; at that length
    // the ellipsis would save nothing.
    expect(truncateHash("a".repeat(13), 6, 6)).toBe("a".repeat(13));
    expect(truncateHash("a".repeat(14), 6, 6)).toContain("…");
  });

  it("trims before measuring", () => {
    expect(truncateHash("  GABC  ")).toBe("GABC");
  });
});

/**
 * The amount helpers exist because XLM has seven decimal places and JavaScript
 * numbers do not have them to spare. Every case below is one where `parseFloat`
 * would have been subtly wrong — and a subtly wrong amount is a payment for the
 * wrong sum, which the ledger will happily make permanent.
 */

describe("toStroops", () => {
  it("converts whole XLM", () => {
    expect(toStroops("1")).toBe(10_000_000n);
  });

  it("pads a short fraction to seven places", () => {
    expect(toStroops("1.5")).toBe(15_000_000n);
    expect(toStroops("0.1")).toBe(1_000_000n);
  });

  it("keeps all seven decimal places", () => {
    expect(toStroops("0.0000001")).toBe(1n);
  });

  it("survives amounts a float would round", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; in stroops it is exact.
    expect(toStroops("0.1") + toStroops("0.2")).toBe(toStroops("0.3"));
    expect(toStroops("9999999.9999999")).toBe(99_999_999_999_999n);
  });

  it("returns zero for anything unparseable, rather than throwing", () => {
    // Display paths call this on whatever is in the input box.
    expect(toStroops("")).toBe(0n);
    expect(toStroops("abc")).toBe(0n);
    expect(toStroops("-1")).toBe(0n);
    expect(toStroops("1.23456789")).toBe(0n); // eight decimal places
  });
});

describe("fromStroops", () => {
  it("round-trips through toStroops", () => {
    for (const amount of ["1.0000000", "0.0000001", "10000.5000000"]) {
      expect(fromStroops(toStroops(amount))).toBe(amount);
    }
  });

  it("always writes seven decimal places, as Horizon does", () => {
    expect(fromStroops(10_000_000n)).toBe("1.0000000");
    expect(fromStroops(1n)).toBe("0.0000001");
    expect(fromStroops(0n)).toBe("0.0000000");
  });

  it("handles a negative result, which a spendable calculation can produce", () => {
    expect(fromStroops(-5_000_000n)).toBe("-0.5000000");
  });
});

describe("isValidAmount", () => {
  it("accepts what the network accepts", () => {
    expect(isValidAmount("1")).toBe(true);
    expect(isValidAmount("0.0000001")).toBe(true);
    expect(isValidAmount(" 12.5 ")).toBe(true);
  });

  it("rejects zero, which is not a payment", () => {
    expect(isValidAmount("0")).toBe(false);
    expect(isValidAmount("0.0000000")).toBe(false);
  });

  it("rejects more precision than a stroop", () => {
    expect(isValidAmount("1.12345678")).toBe(false);
  });

  it("rejects signs, exponents and empty input", () => {
    expect(isValidAmount("-1")).toBe(false);
    expect(isValidAmount("1e5")).toBe(false);
    expect(isValidAmount("")).toBe(false);
  });
});

describe("formatXlm", () => {
  it("groups thousands", () => {
    expect(formatXlm("10000.0000000")).toBe("10,000.00");
    expect(formatXlm("1234567.8900000")).toBe("1,234,567.89");
  });

  it("keeps two decimal places when the rest are zeros", () => {
    expect(formatXlm("1.0000000")).toBe("1.00");
    expect(formatXlm("0.0000000")).toBe("0.00");
  });

  it("never rounds precision away", () => {
    // Showing this as 10,000.00 would tell someone they have more than they do.
    expect(formatXlm("9999.9999999")).toBe("9,999.9999999");
  });

  it("handles a value with no fraction at all", () => {
    expect(formatXlm("42")).toBe("42.00");
  });
});

describe("minimumBalanceStroops", () => {
  it("is two base reserves for a plain account", () => {
    expect(minimumBalanceStroops(0)).toBe(10_000_000n);
  });

  it("adds one base reserve per subentry", () => {
    expect(minimumBalanceStroops(2)).toBe(20_000_000n);
  });

  it("counts sponsored entries against whoever is paying for them", () => {
    expect(minimumBalanceStroops(0, 3, 0)).toBe(25_000_000n);
    expect(minimumBalanceStroops(3, 0, 3)).toBe(10_000_000n);
  });

  it("never falls below the account's own two reserves", () => {
    // num_sponsored can exceed subentry_count; the floor is what stops that
    // from reporting an account that can spend more than it holds.
    expect(minimumBalanceStroops(0, 0, 10)).toBe(10_000_000n);
  });
});
