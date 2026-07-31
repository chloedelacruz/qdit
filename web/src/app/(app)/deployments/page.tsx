import type { Metadata } from "next";
import { GitBranch } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/page-header";
import { HashLink } from "@/components/hash-link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { DEPLOYMENT_STATUS, DEPLOYMENT_STATUS_ORDER } from "@/lib/constants";
import { NETWORK_LABELS } from "@/lib/stellar";
import { DEMO_PROJECTS } from "@/lib/placeholder-data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Deployments" };

export default function DeploymentsPage() {
  const deployed = DEMO_PROJECTS.filter((project) => project.contractId !== null);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Deployments"
        description="Where each contract stands on the road from Testnet to Mainnet."
      />

      {deployed.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No deployments yet"
          description="Once a contract is deployed, record its ID and transaction hash here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {deployed.map((project) => {
            const stageIndex = DEPLOYMENT_STATUS_ORDER.indexOf(project.deployment);

            return (
              <Card key={project.id}>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{project.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {NETWORK_LABELS[project.network]}
                      </p>
                    </div>
                    <StatusBadge state={DEPLOYMENT_STATUS[project.deployment]} />
                  </div>

                  {/* Pipeline: not started → testnet → ready for mainnet → live. */}
                  <ol
                    data-slot="deploy-pipeline"
                    aria-label={`${project.name} deployment pipeline`}
                    className="flex items-center gap-1.5"
                  >
                    {DEPLOYMENT_STATUS_ORDER.map((stage, index) => (
                      <li
                        key={stage}
                        data-slot="deploy-stage"
                        data-reached={index <= stageIndex}
                        className="flex-1"
                      >
                        <span className="sr-only">{DEPLOYMENT_STATUS[stage].label}</span>
                        <span
                          aria-hidden
                          className={cn(
                            "block h-1 rounded-full",
                            index <= stageIndex ? "bg-primary" : "bg-muted",
                          )}
                        />
                      </li>
                    ))}
                  </ol>

                  {project.contractId ? (
                    <HashLink
                      value={project.contractId}
                      kind="contract"
                      network={project.network}
                    />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
