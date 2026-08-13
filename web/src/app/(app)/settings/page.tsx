import type { Metadata } from "next";

import { EditProfileDialog } from "@/components/entity-dialogs";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletConnect } from "@/components/wallet-connect";
import { MEMBER_ROLE } from "@/lib/constants";
import { getOwnIdentity } from "@/lib/queries";
import type { StellarNetwork } from "@/lib/stellar";

const NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await getOwnIdentity();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Workspace preferences and member roles." />

      <Card className="mb-2">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Profile</CardTitle>
          {me ? <EditProfileDialog defaults={{ displayName: me.displayName }} /> : null}
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-medium">Display name</span>
            <span className="text-sm text-muted-foreground">
              {me?.displayName ?? "Unknown"}
            </span>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-medium">Username</span>
            <span className="text-sm text-muted-foreground">
              {/*
                Null only for accounts that predate registration. It is not
                editable here: it is unique, so changing it is a rename that can
                collide, and nothing yet depends on being able to.
              */}
              {me?.username ?? "Not set"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-2">
        <CardHeader>
          <CardTitle>Sign-in</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-medium">Email</span>
            <span className="text-sm text-muted-foreground">
              {me?.email ?? "Unknown"}
            </span>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-medium">Wallet address</span>
            {/*
              The wallet is a credential, not an attestation key — connecting it
              is what signs you in, and the email and password beside it are the
              way back in if it is lost. This component no longer writes the
              address: it is bound once, at registration, and the only accounts
              that can still bind one here are those created before that flow
              existed.
            */}
            <WalletConnect saved={me?.walletAddress ?? null} network={NETWORK} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(MEMBER_ROLE).map(([key, role]) => (
            <div key={key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium">{role.label}</span>
              <span className="text-sm text-muted-foreground">{role.description}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
