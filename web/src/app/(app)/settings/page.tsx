import type { Metadata } from "next";

import { EditProfileDialog } from "@/components/entity-dialogs";
import { HashLink } from "@/components/hash-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MEMBER_ROLE } from "@/lib/constants";
import { getCurrentUserId, listMembers } from "@/lib/queries";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [userId, members] = await Promise.all([getCurrentUserId(), listMembers()]);
  const me = members.find((member) => member.id === userId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Workspace preferences and member roles." />

      <Card className="mb-2">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Profile</CardTitle>
          {me ? (
            <EditProfileDialog
              defaults={{ displayName: me.name, walletAddress: me.walletAddress }}
            />
          ) : null}
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-medium">Display name</span>
            <span className="text-sm text-muted-foreground">{me?.name ?? "Unknown"}</span>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-medium">Wallet address</span>
            {me?.walletAddress ? (
              // Truncated and linked the same way every other strkey is.
              <HashLink value={me.walletAddress} kind="account" network="testnet" />
            ) : (
              <span className="text-sm text-muted-foreground">
                Not set — required to sign milestone proofs on-chain.
              </span>
            )}
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
