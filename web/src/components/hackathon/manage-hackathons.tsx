"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Field, FieldRow, FormDialog } from "@/components/form-dialog";
import { Hint } from "@/components/hint";
import { RowActions } from "@/components/row-actions";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ActionState } from "@/lib/actions";
import { deleteBlockedReason, isoToManilaInput } from "@/lib/hackathon/manage";
import {
  createHackathon,
  deleteHackathon,
  setHackathonHidden,
  updateHackathon,
} from "@/lib/hackathon/manage-actions";
import { formatManila, stateBadge, windowState } from "@/lib/hackathon/window";
import { ICON } from "@/lib/icons";

/** One row of `hackathon_manage_list()`, as the page hands it over. */
export type ManagedHackathon = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  opensAt: string;
  closesAt: string;
  teamMin: number;
  teamMax: number;
  finalistCount: number;
  hidden: boolean;
  releasedAt: string | null;
  entries: number;
  snapshots: number;
  canDelete: boolean;
};

/**
 * The hackathon management page's body (WP-4.7, QDIT-56): every hackathon the
 * caller may manage, New for operators, and per row Edit, Hide/Unhide and
 * Delete. The database decides who may do what; the page only shows the same
 * rules, with the reason wherever something is not offered.
 */
export function ManageHackathons({
  hackathons,
  isOperator,
  nowMs,
}: {
  hackathons: ManagedHackathon[];
  isOperator: boolean;
  nowMs: number;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {hackathons.length} {hackathons.length === 1 ? "hackathon" : "hackathons"}
        </p>
        {isOperator ? (
          <CreateHackathonDialog />
        ) : (
          <Hint label="Only qdit operators can create hackathons.">
            <span>
              <Button size="sm" disabled>
                <ICON.add data-icon="inline-start" />
                New hackathon
              </Button>
            </span>
          </Hint>
        )}
      </div>

      {hackathons.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No hackathons yet. Create the first one.
        </p>
      ) : (
        <div className="surface overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hackathon</TableHead>
                <TableHead>Window (Manila)</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hackathons.map((h) => (
                <HackathonRow key={h.id} h={h} isOperator={isOperator} nowMs={nowMs} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function HackathonRow({ h, isOperator, nowMs }: { h: ManagedHackathon; isOperator: boolean; nowMs: number }) {
  const [pending, startTransition] = useTransition();
  const state = windowState({ opensAt: h.opensAt, closesAt: h.closesAt, releasedAt: h.releasedAt }, nowMs);

  function toggleHidden() {
    startTransition(async () => {
      const result = await setHackathonHidden(h.id, !h.hidden);
      if (result.error) toast.error(result.error);
      else toast.success(h.hidden ? "Listed again" : "Hidden from the list and the banner");
    });
  }

  return (
    <TableRow>
      <TableCell className="min-w-56">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/hackathons/${h.slug}`}
            className="transition-qdit focus-ring rounded-sm font-medium hover:text-primary"
          >
            {h.name}
          </Link>
          {h.hidden ? <StatusBadge dot={false} state={{ label: "Hidden", tone: "neutral" }} /> : null}
        </div>
        <p className="font-mono text-xs text-muted-foreground">/{h.slug}</p>
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">
        {formatManila(h.opensAt)} – {formatManila(h.closesAt)}
      </TableCell>
      <TableCell>
        <StatusBadge state={stateBadge(state)} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {h.entries}
        {h.snapshots > 0 ? (
          <span className="block text-xs text-muted-foreground">
            {h.snapshots} doqtri {h.snapshots === 1 ? "push" : "pushes"}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" disabled={pending} onClick={toggleHidden}>
            {h.hidden ? "Unhide" : "Hide"}
          </Button>
          <RowActions
            label="hackathon"
            persistent
            renderEdit={({ open, onOpenChange }) => (
              <EditHackathonDialog hackathon={h} open={open} onOpenChange={onOpenChange} />
            )}
            deleteTitle={`Delete ${h.name}?`}
            deleteDescription="It goes for good, with its staff list. Only a hackathon no team has sent work to can be deleted."
            onDelete={() => deleteHackathon(h.id)}
            deleteBlocked={deleteBlockedReason(h, isOperator) ?? undefined}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreateHackathonDialog() {
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <ICON.add data-icon="inline-start" />
          New hackathon
        </Button>
      }
      title="New hackathon"
      description="You become its admin. Times are Manila time."
      submitLabel="Create hackathon"
      successMessage="Hackathon created"
      action={createHackathon}
      className="sm:max-w-lg"
    >
      {(state) => <HackathonFields state={state} />}
    </FormDialog>
  );
}

function EditHackathonDialog({
  hackathon,
  open,
  onOpenChange,
}: {
  hackathon: ManagedHackathon;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <FormDialog
      title="Edit hackathon"
      description="Times are Manila time."
      submitLabel="Save changes"
      successMessage="Hackathon updated"
      action={updateHackathon}
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-lg"
    >
      {(state) => (
        <>
          <input type="hidden" name="id" value={hackathon.id} />
          <HackathonFields state={state} defaults={hackathon} />
        </>
      )}
    </FormDialog>
  );
}

function HackathonFields({ state, defaults }: { state: ActionState; defaults?: ManagedHackathon }) {
  const errors = state.fieldErrors ?? {};
  const [hidden, setHidden] = useState(defaults?.hidden ?? false);
  // Once teams have sent work, doqtri finds the hackathon by its slug.
  const slugLocked = defaults ? defaults.entries > 0 || defaults.snapshots > 0 : false;
  const released = Boolean(defaults?.releasedAt);

  return (
    <>
      <Field id="hk-name" label="Name" error={errors.name}>
        <Input id="hk-name" name="name" defaultValue={defaults?.name} maxLength={200} autoComplete="off" />
      </Field>

      <Field
        id="hk-slug"
        label="Slug"
        error={errors.slug}
        hint={
          slugLocked
            ? "Locked: teams have already sent work, and doqtri finds the hackathon by its slug."
            : "The address: /hackathons/<slug>. Lowercase letters, digits and dashes."
        }
      >
        <Input
          id="hk-slug"
          name="slug"
          defaultValue={defaults?.slug}
          readOnly={slugLocked}
          maxLength={64}
          autoComplete="off"
          className="font-mono"
        />
      </Field>

      <Field id="hk-description" label="Description" optional error={errors.description}>
        <Textarea id="hk-description" name="description" defaultValue={defaults?.description ?? ""} rows={3} maxLength={4000} />
      </Field>

      <FieldRow>
        <Field id="hk-opens" label="Opens" error={errors.opensAt}>
          <Input
            id="hk-opens"
            name="opensAt"
            type="datetime-local"
            defaultValue={defaults ? isoToManilaInput(defaults.opensAt) : ""}
            readOnly={released}
          />
        </Field>
        <Field id="hk-closes" label="Closes" error={errors.closesAt}>
          <Input
            id="hk-closes"
            name="closesAt"
            type="datetime-local"
            defaultValue={defaults ? isoToManilaInput(defaults.closesAt) : ""}
            readOnly={released}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field id="hk-team-min" label="Smallest team" error={errors.teamMin}>
          <Input id="hk-team-min" name="teamMin" type="number" min={1} max={20} defaultValue={defaults?.teamMin ?? 3} readOnly={released} />
        </Field>
        <Field id="hk-team-max" label="Largest team" error={errors.teamMax}>
          <Input id="hk-team-max" name="teamMax" type="number" min={1} max={20} defaultValue={defaults?.teamMax ?? 4} readOnly={released} />
        </Field>
      </FieldRow>

      <Field
        id="hk-finalists"
        label="Finalists"
        error={errors.finalistCount}
        hint={released ? "Grades are released, so dates, team size and finalists stay as they are." : "1 to 10, pitched to the judges."}
      >
        <Input id="hk-finalists" name="finalistCount" type="number" min={1} max={10} defaultValue={defaults?.finalistCount ?? 10} readOnly={released} />
      </Field>

      <input type="hidden" name="hidden" value={String(hidden)} />
      <label htmlFor="hk-hidden" className="flex items-start gap-2.5 text-sm">
        <Checkbox id="hk-hidden" checked={hidden} onCheckedChange={(v) => setHidden(v === true)} className="mt-0.5" />
        <span>
          Hidden
          <span className="block text-xs text-muted-foreground">
            Left out of the Hackathons list and the site banner. Its page still opens by link.
          </span>
        </span>
      </label>
    </>
  );
}
