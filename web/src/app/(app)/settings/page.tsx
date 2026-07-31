import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MEMBER_ROLE } from "@/lib/constants";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Workspace preferences and member roles." />

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
