import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProofChain } from "@/components/proof-chain";
import type { ChainStep } from "@/lib/proof-chain";

/**
 * What the public page's proof chain renders (WP-3.3): an ordered list of
 * four steps whose state is a word, not a colour alone. Server-rendered to
 * markup, like the other public-page components' tests. Which state each
 * step is in is lib/proof-chain.test.ts's job; this checks how each state
 * reads.
 */

const PROOF_CONTRACT = "CBP3NKXCRUSOJLLUXDF5AIRNPAC6IL7TFJ2KCNL5A2GTKC2MB7M4OHVG";
const REGISTRY = "CCCIDUCFQMTMAGESMPTB3MFW4TURS62ORSZNICFOE6MNQZO3MI7F6QRJ";
const OWNER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const HASH = "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab";
const SUBMIT_TX = "5e1f0c3a9b7d2e4f6a8c0b1d3e5f7a9c2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d0f";

const base = (key: ChainStep["key"], title: string, state: ChainStep["state"], summary: string): ChainStep => ({
  key,
  title,
  state,
  summary,
  at: null,
  proofHash: null,
  signer: null,
  link: null,
});

const STEPS: ChainStep[] = [
  {
    ...base("plan", "Plan version", "done", "Planned in node h4 of a doqtri plan anchored at v3 on Testnet."),
    at: { iso: "2026-10-24T12:00:00.000Z", source: "ledger" },
    link: { kind: "contract", contractId: REGISTRY, network: "testnet", note: "qdit does not keep doqtri's transactions." },
  },
  {
    ...base("submitted", "Submitted", "done", "Proof v2 submitted on Testnet."),
    at: { iso: "2026-10-22T08:11:40.000Z", source: "ledger" },
    proofHash: HASH,
    signer: { address: OWNER, network: "testnet" },
    link: { kind: "tx", hash: SUBMIT_TX, network: "testnet", ledger: 123458, unconfirmed: false },
  },
  base("approved", "Approved", "pending", "v2 awaits the project owner's decision on Testnet."),
  base("verified", "Verified in doqtri", "unchecked", "DoqtriRegistry on Testnet did not answer just now."),
];

const render = (steps: ChainStep[] = STEPS) => renderToStaticMarkup(createElement(ProofChain, { steps }));

/** The words a reader sees: tags stripped, quotes unescaped. */
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Each `<li>`'s markup, in order. */
const items = (html: string) => [...html.matchAll(/<li [\s\S]*?<\/li>/g)].map((m) => m[0]);

describe("ProofChain", () => {
  it("is a labelled section with an ordered list of the four steps, in order", () => {
    const html = render();

    expect(html).toMatch(/^<section data-slot="proof-chain" aria-labelledby="proof-chain-heading"/);
    expect(html).toContain('<h2 id="proof-chain-heading" class="text-sm font-medium">Proof chain</h2>');
    expect(html).toContain('<ol role="list"');
    expect(items(html).map((li) => /data-step="([a-z]+)"/.exec(li)?.[1])).toEqual([
      "plan",
      "submitted",
      "approved",
      "verified",
    ]);
  });

  it("says every state in words, with the icon hidden from screen readers", () => {
    const html = render([
      base("plan", "Plan version", "done", "a"),
      base("submitted", "Submitted", "pending", "b"),
      base("approved", "Approved", "mismatch", "c"),
      base("verified", "Verified in doqtri", "unchecked", "d"),
    ]);
    const states = items(html).map((li) => words(/<span data-slot="step-state"[\s\S]*?<\/span>/.exec(li)?.[0] ?? ""));

    expect(states).toEqual(["Done", "Pending", "Does not match", "Could not check"]);
    for (const li of items(html)) {
      expect(/<span data-slot="step-state"[^>]*>\s*<svg[^>]*aria-hidden="true"/.test(li)).toBe(true);
    }
    // Only a done step is in the success tone, and only a mismatch in the warning tone.
    expect(items(html)[0]).toContain("text-success");
    expect(items(html)[2]).toContain("text-warning");
    expect(items(html)[1]).not.toMatch(/text-(success|warning)/);
    expect(items(html)[3]).not.toMatch(/text-(success|warning)/);
  });

  it("marks the first step that is not done as the current one, and none when all are done", () => {
    const html = render();
    expect(items(html).map((li) => li.includes('aria-current="step"'))).toEqual([false, false, true, false]);

    const done = render(STEPS.map((step) => ({ ...step, state: "done" })));
    expect(done).not.toContain("aria-current");
  });

  it("keeps the step number visual only; the list gives the order", () => {
    const first = items(render())[0];
    expect(first).toMatch(/<span aria-hidden="true" class="[^"]*">1<\/span>/);
    expect(words(first)).toMatch(/^1 Plan version Done/);
  });

  it("shows a step's time, ledger, proof hash, transaction and signer", () => {
    const submitted = items(render())[1];
    const text = words(submitted);

    expect(submitted).toContain('<time dateTime="2026-10-22T08:11:40.000Z">2026-10-22 08:11 UTC</time>');
    expect(text).toContain("Ledger time 2026-10-22 08:11 UTC · ledger 123458");
    expect(text).toContain(`Proof hash ${HASH}`);
    expect(submitted).toContain(`https://stellar.expert/explorer/testnet/tx/${SUBMIT_TX}"`);
    expect(submitted).toContain(`https://stellar.expert/explorer/testnet/account/${OWNER}"`);
    expect(text).not.toContain("unconfirmed");
  });

  it("says when qdit's transaction is unconfirmed, and a time qdit recorded is said to be qdit's", () => {
    const step: ChainStep = {
      ...base("approved", "Approved", "unchecked", "milestone_proof on Testnet could not be read just now."),
      at: { iso: "2026-10-23T10:00:00.000Z", source: "qdit" },
      link: { kind: "tx", hash: SUBMIT_TX, network: "testnet", ledger: null, unconfirmed: true },
    };
    const text = words(render([step]));
    expect(text).toContain("Transaction qdit recorded (unconfirmed)");
    expect(text).toContain("Recorded by qdit 2026-10-23 10:00 UTC");
    expect(text).not.toContain("ledger");
  });

  it("links the contract and says why when there is no transaction", () => {
    const step: ChainStep = {
      ...base("approved", "Approved", "done", "v2 approved on Mainnet."),
      link: { kind: "contract", contractId: PROOF_CONTRACT, network: "mainnet", note: "older than the RPC event window" },
    };
    const html = render([step]);
    expect(html).toContain(`https://stellar.expert/explorer/public/contract/${PROOF_CONTRACT}"`);
    expect(words(html)).toContain("Contract on Mainnet");
    expect(words(html)).toContain("older than the RPC event window");
  });

  it("links a contract submitter as a contract, not an account", () => {
    const step: ChainStep = { ...STEPS[1], signer: { address: PROOF_CONTRACT, network: "testnet" } };
    expect(render([step])).toContain(`/testnet/contract/${PROOF_CONTRACT}"`);
  });
});
