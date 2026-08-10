"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";

import { HashLink } from "@/components/hash-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/form-dialog";
import type { VerifiedTx } from "@/app/api/verify-tx/route";
import { isTxHash, NETWORK_LABELS, type StellarNetwork } from "@/lib/stellar";
import { cn } from "@/lib/utils";

/**
 * Spec §8. Checks a hash against Horizon and reports what is actually on the
 * ledger — as opposed to what someone typed into a proof record.
 *
 * This is the difference between a claim and a proof: the registry stores
 * whatever was pasted, and this says whether the network agrees. A hash that
 * verifies on Testnet but was recorded as Mainnet is exactly the kind of
 * mistake worth catching, so the network is a field rather than an assumption.
 */
export function VerifyTx() {
  const [hash, setHash] = useState("");
  const [network, setNetwork] = useState<StellarNetwork>("testnet");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<VerifiedTx | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valid = isTxHash(hash);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;

    setPending(true);
    setResult(null);
    setError(null);

    try {
      const response = await fetch(
        `/api/verify-tx?hash=${encodeURIComponent(hash.trim())}&network=${network}`,
      );
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Could not verify that transaction.");
      } else {
        setResult(body as VerifiedTx);
      }
    } catch {
      setError("Could not reach the network. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      data-slot="verify-tx"
      aria-label="Verify a transaction"
      className="surface mb-4 rounded-xl border border-border p-3"
    >
      <form onSubmit={verify} className="flex flex-wrap items-center gap-2">
        <Input
          value={hash}
          onChange={(event) => setHash(event.target.value)}
          placeholder="Paste a transaction hash to verify it on-chain…"
          spellCheck={false}
          aria-label="Transaction hash"
          aria-invalid={hash.length > 0 && !valid}
          className="min-w-0 flex-1"
        />

        <SelectField
          value={network}
          onValueChange={(next) => setNetwork(next as StellarNetwork)}
          aria-label="Network"
          className="w-32"
        >
          {Object.entries(NETWORK_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>

        <Button type="submit" disabled={!valid || pending}>
          {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
          Verify
        </Button>
      </form>

      {hash.length > 0 && !valid ? (
        <p className="mt-2 text-xs text-muted-foreground">
          A transaction hash is 64 hex characters.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <XCircle className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {result ? (
        <dl
          data-slot="verify-result"
          className="mt-3 grid gap-x-4 gap-y-1.5 border-t border-border/70 pt-3 text-sm sm:grid-cols-[auto_1fr]"
        >
          <Row label="Result">
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                // A transaction can be included in a ledger and still have
                // failed. Saying only "found" would read as an endorsement.
                result.successful ? "text-success" : "text-destructive",
              )}
            >
              {result.successful ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <XCircle className="size-3.5" />
              )}
              {result.successful ? "Succeeded" : "Failed on-chain"}
            </span>
          </Row>

          <Row label="Transaction">
            <HashLink value={result.hash} kind="tx" network={result.network} />
          </Row>

          <Row label="Source">
            <HashLink value={result.sourceAccount} kind="account" network={result.network} />
          </Row>

          <Row label="Ledger">
            <span className="tabular-nums">{result.ledger.toLocaleString()}</span>
          </Row>

          <Row label="When">{result.createdAt.replace("T", " ").replace("Z", " UTC")}</Row>

          <Row label="Operations">
            <span className="tabular-nums">{result.operationCount}</span>
          </Row>

          {result.memo ? <Row label="Memo">{result.memo}</Row> : null}
        </dl>
      ) : null}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
