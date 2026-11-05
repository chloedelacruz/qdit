import type { Metadata } from "next";

import { AuthorizedApps } from "@/components/authorized-apps";
import { EditProfileDialog } from "@/components/entity-dialogs";
import { InfoBubble } from "@/components/hint";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WalletConnect } from "@/components/wallet-connect";
import { MEMBER_ROLE } from "@/lib/constants";
import { getOwnIdentity, listAuthorizedApps } from "@/lib/queries";
import type { StellarNetwork } from "@/lib/stellar";

const NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  // Independent reads: the grants come from Auth, the identity from profiles.
  const [me, apps] = await Promise.all([getOwnIdentity(), listAuthorizedApps()]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" info="Your profile, how you sign in, connected apps and what each role can do." />

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

      <Card className="mb-2">
        <CardHeader className="flex flex-row items-center gap-1.5">
          <CardTitle>Authorized apps</CardTitle>
          {/* What belongs here, said once beside the title instead of in the
              empty state (QDIT-34). */}
          <InfoBubble label="authorized apps">
            <p>
              Apps you allowed to act for you in qdit, such as doqtri. Revoking one
              takes effect straight away.
            </p>
          </InfoBubble>
        </CardHeader>
        <CardContent>
          {/*
            Apps that act for you through qdit's OAuth server. What they may do
            is fixed by the database, not by what they asked for — see
            supabase/migrations/20261024110000_oauth_client_guards.sql.
          */}
          <AuthorizedApps apps={apps} />
        </CardContent>
      </Card>

      {/*
        Reference, not a setting: nothing here can be changed. So the card says
        which roles exist and keeps what each may do one tap away, instead of
        four lines of static prose at the foot of the page (QDIT-34).
      */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-1.5">
          <CardTitle>Roles</CardTitle>
          <InfoBubble label="roles">
            <dl className="space-y-1.5">
              {Object.entries(MEMBER_ROLE).map(([key, role]) => (
                <div key={key}>
                  <dt className="font-medium text-foreground">{role.label}</dt>
                  <dd>{role.description}</dd>
                </div>
              ))}
            </dl>
          </InfoBubble>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {Object.entries(MEMBER_ROLE).map(([key, role]) => (
            <Badge key={key} variant="outline" className="font-normal">
              {role.label}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
