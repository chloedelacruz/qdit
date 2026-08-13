"use client";

import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { AccountBalance } from "@/app/api/balance/route";
import { Field } from "@/components/form-dialog";
import { HashLink } from "@/components/hash-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { preparePayment, sendPayment } from "@/lib/payment/actions";
import { paymentSchema } from "@/lib/schemas";
import { formatXlm, toStroops, type StellarNetwork } from "@/lib/stellar";
import { isRejectedError, signTransaction } from "@/lib/wallet";

/**
 * Send XLM from the connected wallet.
 *
 * Four steps, three of which the person can see:
 *
 *   1. `preparePayment` — the server loads the account, decides between a
 *      `payment` and a `createAccount`, and returns unsigned XDR;
 *   2. the wallet signs it, and shows the amount and destination itself — the
 *      last checkpoint, and the only one this app does not control;
 *   3. `sendPayment` — the server re-verifies the signed envelope and submits;
 *   4. the hash comes back and stays on screen.
 *
 * Step 4 is the point. A payment that succeeded and left nothing behind is
 * indistinguishable to the user from one that vanished, so the hash is shown
 * with a copy button and an explorer link, and the form does not reset itself
 * out from under it.
 */

type Stage = "idle" | "preparing" | "signing" | "submitting";

type Receipt = {
  txHash: string;
  ledger: number;
  destination: string;
  amount: string;
  /** True when the payment brought the destination account into existence. */
  created: boolean;
};

const EMPTY = { destination: "", amount: "", memo: "" };

export function SendPayment({
  address,
  balance,
  network,
  onSent,
}: {
  address: string;
  balance: AccountBalance | null;
  network: StellarNetwork;
  /** Called after a confirmed payment, so the balance can be refetched. */
  onSent: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [stage, setStage] = useState<Stage>("idle");
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const busy = pending || stage !== "idle";

  // Advisory, not a gate: the balance may be stale by the time this submits,
  // and the network is the only thing that can actually refuse a payment.
  const overspending =
    balance !== null &&
    balance.funded &&
    toStroops(form.amount) > toStroops(balance.spendable);

  function set(field: keyof typeof EMPTY, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function run() {
    setError(null);
    setReceipt(null);

    // The same schema the action re-runs. This copy is for the red text under
    // the field; that one is the boundary.
    const parsed = paymentSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      try {
        setStage("preparing");
        const prepared = await preparePayment(address, form);

        if (!prepared.ok) {
          if (prepared.fieldErrors) setFieldErrors(prepared.fieldErrors);
          if (prepared.error) setError(prepared.error);
          setStage("idle");
          return;
        }

        setStage("signing");
        const signedXdr = await signTransaction(prepared.data.xdr);

        setStage("submitting");
        const sent = await sendPayment(signedXdr, {
          source: address,
          destination: prepared.data.destination,
          amount: prepared.data.amount,
        });

        if (!sent.ok) {
          setError(sent.error);
          setStage("idle");
          return;
        }

        setReceipt({
          txHash: sent.data.txHash,
          ledger: sent.data.ledger,
          destination: prepared.data.destination,
          amount: prepared.data.amount,
          created: prepared.data.kind === "createAccount",
        });
        setForm(EMPTY);
        setStage("idle");
        toast.success(`Sent ${formatXlm(prepared.data.amount)} XLM`);
        onSent();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setStage("idle");

        // Declining in the wallet is a decision, not a failure.
        if (isRejectedError(message)) return;
        setError(message);
      }
    });
  }

  return (
    <section aria-label="Send XLM" className="space-y-3">
      <h3 className="text-sm font-medium">Send XLM</h3>

      <div className="space-y-3">
        <Field
          id="payment-destination"
          label="Destination"
          error={fieldErrors.destination}
          hint="The Stellar address to pay."
        >
          <Input
            id="payment-destination"
            value={form.destination}
            onChange={(event) => set("destination", event.target.value)}
            placeholder="G…"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.destination)}
            className="font-mono text-xs"
          />
        </Field>

        <Field
          id="payment-amount"
          label="Amount (XLM)"
          error={fieldErrors.amount}
          hint={
            balance?.funded
              ? `${formatXlm(balance.spendable)} XLM spendable.`
              : "Up to 7 decimal places."
          }
        >
          <Input
            id="payment-amount"
            value={form.amount}
            onChange={(event) => set("amount", event.target.value)}
            placeholder="0.0000000"
            inputMode="decimal"
            autoComplete="off"
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.amount)}
            className="tabular-nums"
          />
        </Field>

        <Field
          id="payment-memo"
          label="Memo"
          optional
          error={fieldErrors.memo}
          hint="Attached to the transaction on the ledger. At most 28 bytes."
        >
          <Input
            id="payment-memo"
            value={form.memo}
            onChange={(event) => set("memo", event.target.value)}
            disabled={busy}
            aria-invalid={Boolean(fieldErrors.memo)}
          />
        </Field>
      </div>

      {overspending ? (
        <p className="text-sm text-warning">
          That is more than this account can send. It has to keep{" "}
          {balance ? formatXlm(balance.reserve) : "its"} XLM in reserve.
        </p>
      ) : null}

      {stage !== "idle" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {stage === "preparing"
            ? "Building the transaction…"
            : stage === "signing"
              ? "Waiting for your wallet…"
              : "Submitted. Waiting for the ledger to close…"}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {receipt ? (
        <div
          data-slot="payment-receipt"
          className="surface space-y-2 rounded-xl border border-success/30 p-3"
        >
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            Sent {formatXlm(receipt.amount)} XLM
            {receipt.created ? ", creating the destination account" : ""}.
          </p>

          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">Transaction</dt>
            <dd className="min-w-0">
              <HashLink value={receipt.txHash} kind="tx" network={network} />
            </dd>

            <dt className="text-muted-foreground">To</dt>
            <dd className="min-w-0">
              <HashLink value={receipt.destination} kind="account" network={network} />
            </dd>

            <dt className="text-muted-foreground">Ledger</dt>
            <dd className="tabular-nums">{receipt.ledger.toLocaleString()}</dd>
          </dl>
        </div>
      ) : null}

      <Button onClick={run} disabled={busy}>
        {busy ? (
          <Loader2 className="animate-spin" data-icon="inline-start" />
        ) : (
          <Send data-icon="inline-start" aria-hidden />
        )}
        {busy ? "Sending…" : "Send XLM"}
      </Button>
    </section>
  );
}
