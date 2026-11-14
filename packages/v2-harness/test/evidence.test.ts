import assert from "node:assert/strict";
import { test } from "node:test";

import { evidencePath, renderEvidence, type Run } from "../src/evidence.ts";

const TX = "0db66be185c999a410d0f9cfd57b2e3ef71d3cfd6379f6d02cefdbe6d243857b";
const ADDR = "GDSB6DG33VYIQYRLWBM5XB6H2T2BQQOCQTODQXXSGK7Q44CSA5SAIJZG";

const run: Run = {
  date: "2026-11-14",
  startedAt: "2026-11-14T13:00:00.000Z",
  finishedAt: "2026-11-14T13:05:00.000Z",
  contractId: "CDDIVHDM66BHZ3ZWHTYXSD5KHL4S5SJOALDSHR3UATRZ655POIKSBT6N",
  wasmHash: "8b1d6944c94a7bcfb3119d6b0444418ad2c10f855237e9408f954beafd3e3548",
  rpcUrl: "https://soroban-testnet.stellar.org",
  projectId: "8f14e45f-ceea-467a-9b7e-5a0dcbf1c8b2",
  accounts: [{ role: "owner", address: ADDR }],
  steps: [
    { kind: "sent", title: "create_project", signer: "owner", outcome: "ok", txHash: TX, ledger: 42 },
    { kind: "read", title: "get_members", signer: "anyone", outcome: "4 members" },
    { kind: "refused", title: "submit by a non-member", signer: "outsider", expected: "NotMember", code: 7, hostError: "Error(Contract, #7)" },
  ],
};

test("the file is named for the run's date", () => {
  assert.equal(evidencePath("2026-11-14"), "docs/evidence/v2-harness-2026-11-14.md");
});

test("every sent step links its transaction on Stellar Expert", () => {
  const md = renderEvidence(run);
  assert.match(md, new RegExp(`\\| 1 \\| create_project \\| owner \\| ok \\| \\[\`0db66be1…43857b\`\\]\\(https://stellar.expert/explorer/testnet/tx/${TX}\\) \\(ledger 42\\) \\|`));
});

test("a refusal shows its expected error, code and host error", () => {
  const md = renderEvidence(run);
  assert.match(md, /\| 3 \| submit by a non-member \| outsider \| refused: `NotMember` \(#7\) \|/);
  assert.match(md, /\| 3 \| submit by a non-member \| outsider \| `NotMember` \(#7\) \| `Error\(Contract, #7\)` \|/);
});

test("the header counts each kind of step and links the contract and accounts", () => {
  const md = renderEvidence(run);
  assert.match(md, /\| Steps \| 3: 1 sent, 1 refused as expected, 1 simulated reads \|/);
  assert.match(md, /explorer\/testnet\/contract\/CDDIVHDM66BHZ3ZWHTYXSD5KHL4S5SJOALDSHR3UATRZ655POIKSBT6N/);
  assert.match(md, new RegExp(`explorer/testnet/account/${ADDR}`));
});
