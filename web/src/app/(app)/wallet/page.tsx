import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletPanel } from "@/components/wallet/wallet-panel";
import { getOwnIdentity } from "@/lib/queries";
import { NETWORK_LABELS, type StellarNetwork } from "@/lib/stellar";

const NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const metadata: Metadata = { title: "Wallet" };

/**
 * The wallet as a thing in itself, rather than a step inside anchoring.
 *
 * Everywhere else in qdit the wallet appears mid-task: it signs a challenge on
 * the way in, or a proof on the way to the ledger, and disappears again. That
 * leaves no answer to "is it connected, and what is in it" — which is the
 * question someone actually asks before signing anything.
 */
export default async function WalletPage() {
  const me = await getOwnIdentity();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Wallet"
        description={`Connect a Stellar wallet, check its balance, and send XLM on ${NETWORK_LABELS[NETWORK]}.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>{NETWORK_LABELS[NETWORK]} wallet</CardTitle>
        </CardHeader>

        <CardContent>
          {/*
            The registered address is passed in only so the panel can say when
            the extension is on a different account. It is never written from
            here — binding happens once, at registration.
          */}
          <WalletPanel registered={me?.walletAddress ?? null} network={NETWORK} />
        </CardContent>
      </Card>
    </div>
  );
}
