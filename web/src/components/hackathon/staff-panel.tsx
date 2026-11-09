"use client";

import { startTransition, useActionState, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Field, SelectField } from "@/components/form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addHackathonStaff,
  removeHackathonStaff,
  type StaffActionState,
} from "@/lib/hackathon/staff-actions";
import { toPlainText } from "@/lib/hackathon/staff-view";
import { ICON } from "@/lib/icons";

export interface StaffMember {
  user_id: string;
  username: string | null;
  display_name: string | null;
  role: "admin" | "judge";
}

/**
 * Hackathon staff (WP-4.7, D-115): list, add by username as admin or judge
 * (adding someone already listed changes their role), remove. The last-admin
 * and staff-on-team refusals come back as sentences and show in place.
 */
export function StaffPanel({
  hackathonId,
  staff,
  currentUserId,
}: {
  hackathonId: string;
  staff: StaffMember[];
  currentUserId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: StaffActionState, formData: FormData) => {
      const result = await addHackathonStaff(prev, formData);
      if (result.ok) {
        formRef.current?.reset();
        toast.success("Staff updated.");
      }
      return result;
    },
    {} as StaffActionState,
  );

  return (
    <div className="divide-y divide-border">
      <ul aria-label="Staff">
        {staff.map((member) => (
          <StaffRow
            key={member.user_id}
            hackathonId={hackathonId}
            member={member}
            isSelf={member.user_id === currentUserId}
          />
        ))}
      </ul>

      <form
        ref={formRef}
        noValidate
        className="space-y-2 px-3 py-3"
        action={formAction}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => formAction(data));
        }}
      >
        <input type="hidden" name="hackathonId" value={hackathonId} />
        <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
          <Field id="staff-username" label="Username" error={state.fieldErrors?.username}>
            <Input id="staff-username" name="username" placeholder="username" autoComplete="off" />
          </Field>
          <Field id="staff-role" label="Role" error={state.fieldErrors?.role}>
            <SelectField id="staff-role" name="role" defaultValue="judge">
              <option value="judge">Judge</option>
              <option value="admin">Admin</option>
            </SelectField>
          </Field>
          <Button type="submit" disabled={pending} className="pointer-coarse:h-11">
            {pending ? <ICON.spinner className="animate-spin" data-icon="inline-start" /> : null}
            Add or change
          </Button>
        </div>
        {state.error ? (
          <p role="alert" className="text-xs text-destructive">
            {state.error}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function StaffRow({
  hackathonId,
  member,
  isSelf,
}: {
  hackathonId: string;
  member: StaffMember;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const name = toPlainText(member.username ?? member.user_id.slice(0, 8), 64);

  return (
    <li className="px-3 py-1.5 text-sm">
      <div className="flex min-h-6 items-center gap-3">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">@{name}</span>
        {member.display_name ? (
          <span className="ml-2 text-muted-foreground">{toPlainText(member.display_name, 120)}</span>
        ) : null}
        {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
      </span>
      <StatusBadge
        dot={false}
        state={{ label: member.role === "admin" ? "Admin" : "Judge", tone: member.role === "admin" ? "accent" : "neutral" }}
      />
      <Button
        size="xs"
        variant="ghost"
        disabled={pending || !member.username}
        aria-label={`Remove @${name}`}
        onClick={() =>
          start(async () => {
            const result = await removeHackathonStaff(hackathonId, member.username ?? "");
            setError(result.ok ? null : (result.error ?? "Could not remove."));
            if (result.ok) toast.success(`Removed @${name}.`);
          })
        }
      >
        {pending ? <ICON.spinner className="animate-spin" /> : null}
        Remove
      </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
