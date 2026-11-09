"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Field, FormDialog, SelectField } from "@/components/form-dialog";
import { DisabledReason } from "@/components/hint";
import { ImageUpload, type SlotValue } from "@/components/hackathon/image-upload";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/actions";
import { submitHackathonEntry } from "@/lib/hackathon/actions";
import { markEdited, noEdits, visibleFieldErrors } from "@/lib/hackathon/form-errors";
import { acceptsUpload, formerMembersNote, rosterMembers } from "@/lib/hackathon/team";
import { IMAGE_SLOTS, TEAM_NAME_MAX } from "@/lib/hackathon/schemas";
import { ICON } from "@/lib/icons";

/** One project the caller may submit, as the page hands it over. */
export type SubmitProject = {
  id: string;
  name: string;
  members: { id: string; name: string; username: string | null }[];
  /** A short line about the latest doqtri snapshot, already worded by the page. */
  doqtriStatus: string | null;
  /** What the entry holds now, to start from on an update. */
  entry: {
    teamName: string;
    memberIds: string[];
    images: { path: string; url: string | null }[];
  } | null;
};

const NO_DOQTRI =
  "No doqtri snapshot yet. In doqtri, open the global mindmap and use Send to qdit hackathon.";

/**
 * "Add submission to hackathon" (WP-4.7, QDIT-47, D-115).
 *
 * The trigger is the page's primary action. It stays visible and disabled,
 * with the reason, when there is nothing the caller can submit right now
 * (spec §Explainers and disabled controls).
 */
export function SubmitForm({
  hackathonId,
  teamMin,
  teamMax,
  projects,
  label,
  disabledReason,
}: {
  hackathonId: string;
  teamMin: number;
  teamMax: number;
  /** Projects the caller is owner or admin of, open for submitting now. */
  projects: SubmitProject[];
  label: string;
  /** Set when the button cannot be used; shown as its tooltip. */
  disabledReason: string | null;
}) {
  // Which slots are mid-upload. A ref, because the action reads it at submit
  // time and must not see the value from the render that created it.
  const busySlots = useRef(new Set<string>());
  const onBusyChange = useCallback((slot: string, busy: boolean) => {
    if (busy) busySlots.current.add(slot);
    else busySlots.current.delete(slot);
  }, []);

  const action = useCallback(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      if (busySlots.current.size > 0) {
        return { error: "Wait for the images to finish uploading, then submit." };
      }
      return submitHackathonEntry(prev, formData);
    },
    [],
  );

  const trigger = (
    <Button size="sm">
      <ICON.send data-icon="inline-start" />
      {label}
    </Button>
  );

  // A new FormDialog per opening: its action state (and so every error from
  // the last attempt) starts empty each time the dialog opens.
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  const onOpenChange = useCallback((next: boolean) => {
    if (next) setOpening((n) => n + 1);
    setOpen(next);
  }, []);

  if (disabledReason || projects.length === 0) {
    return (
      <DisabledReason reason={disabledReason ?? "Nothing to submit right now."}>
        <Button size="sm" disabled>
          <ICON.send data-icon="inline-start" />
          {label}
        </Button>
      </DisabledReason>
    );
  }

  return (
    <FormDialog
      key={opening}
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      title={label}
      description="Your qdit project, your latest doqtri snapshot and these images are saved together as one submission."
      submitLabel="Submit"
      successMessage="Submission received."
      action={action}
      singleSubmit
      className="sm:max-w-lg"
    >
      {(state) => (
        <SubmitFields
          state={state}
          hackathonId={hackathonId}
          teamMin={teamMin}
          teamMax={teamMax}
          projects={projects}
          onBusyChange={onBusyChange}
        />
      )}
    </FormDialog>
  );
}

/** The saved team, without anyone who has left the project since. */
function startingTeam(project: SubmitProject | undefined) {
  return rosterMembers(project?.entry?.memberIds ?? [], project?.members ?? []);
}

function initialSlots(project: SubmitProject | undefined): (SlotValue | null)[] {
  const images = project?.entry?.images ?? [];
  return IMAGE_SLOTS.map((_, index) =>
    images[index] ? { path: images[index].path, previewUrl: images[index].url } : null,
  );
}

/**
 * The dialog's body. Mounted each time the dialog opens, so it starts from the
 * chosen project's current entry every time.
 */
function SubmitFields({
  state,
  hackathonId,
  teamMin,
  teamMax,
  projects,
  onBusyChange,
}: {
  state: ActionState;
  hackathonId: string;
  teamMin: number;
  teamMax: number;
  projects: SubmitProject[];
  onBusyChange: (slot: string, busy: boolean) => void;
}) {
  const [projectId, setProjectId] = useState(
    () => (projects.find((p) => p.entry) ?? projects[0])?.id ?? "",
  );
  const project = projects.find((p) => p.id === projectId);

  const [teamName, setTeamName] = useState(project?.entry?.teamName ?? "");
  const [memberIds, setMemberIds] = useState<string[]>(() => startingTeam(project).kept);
  const [removedMembers, setRemovedMembers] = useState(() => startingTeam(project).removed);
  const [slots, setSlots] = useState(() => initialSlots(project));

  // Read when an upload finishes, which can be after the project changed or
  // the dialog closed (this component unmounts on close).
  const live = useRef({ projectId, open: true });
  useEffect(() => {
    const current = live.current;
    current.open = true;
    return () => {
      current.open = false;
    };
  }, []);

  // A field's error from the last submit goes as soon as that field changes.
  const [edited, setEdited] = useState(() => noEdits(state));
  const touched = (...fields: string[]) => setEdited((current) => markEdited(current, state, ...fields));

  function chooseProject(id: string) {
    const next = projects.find((p) => p.id === id);
    setProjectId(id);
    live.current.projectId = id;
    touched("projectId", "teamName", "memberIds", "images");
    // Images are stored under the project, so they never carry over.
    setTeamName(next?.entry?.teamName ?? teamName);
    const team = startingTeam(next);
    setMemberIds(team.kept);
    setRemovedMembers(team.removed);
    setSlots(initialSlots(next));
  }

  function toggleMember(id: string, checked: boolean) {
    touched("memberIds");
    setMemberIds((current) =>
      checked ? (current.includes(id) ? current : [...current, id]) : current.filter((m) => m !== id),
    );
  }

  const errors = visibleFieldErrors(state, edited);
  const full = memberIds.length >= teamMax;
  const sizeHint =
    teamMin === teamMax ? `Choose ${teamMin}.` : `Choose ${teamMin} to ${teamMax}.`;

  return (
    <>
      <input type="hidden" name="hackathonId" value={hackathonId} />

      <Field id="hackathon-project" label="Team project" error={errors.projectId}>
        {projects.length === 1 ? (
          <>
            <input type="hidden" name="projectId" value={projectId} />
            <p id="hackathon-project" className="text-sm">
              {project?.name}
            </p>
          </>
        ) : (
          <SelectField
            id="hackathon-project"
            name="projectId"
            value={projectId}
            onValueChange={chooseProject}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        )}
      </Field>

      <Field id="hackathon-team-name" label="Team name" error={errors.teamName}>
        <Input
          id="hackathon-team-name"
          name="teamName"
          value={teamName}
          onChange={(event) => {
            touched("teamName");
            setTeamName(event.target.value);
          }}
          maxLength={TEAM_NAME_MAX}
          autoComplete="off"
          aria-invalid={errors.teamName ? true : undefined}
          aria-describedby={errors.teamName ? "hackathon-team-name-error" : undefined}
        />
      </Field>

      <fieldset className="space-y-1.5" aria-describedby="hackathon-members-status">
        <legend className="flex w-full items-center justify-between text-sm font-medium">
          Team members
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {memberIds.length} selected
          </span>
        </legend>

        {memberIds.map((id) => (
          <input key={id} type="hidden" name="memberIds" value={id} />
        ))}

        {project && project.members.length > 0 ? (
          <ul className="well max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {project.members.map((member) => {
              const checked = memberIds.includes(member.id);
              const boxId = `hackathon-member-${member.id}`;
              return (
                <li key={member.id} className="flex min-h-9 items-center gap-2.5 px-2.5">
                  <Checkbox
                    id={boxId}
                    checked={checked}
                    disabled={!checked && full}
                    onCheckedChange={(value) => toggleMember(member.id, value === true)}
                  />
                  <label htmlFor={boxId} className="flex min-w-0 flex-1 items-baseline gap-1.5 py-2 text-sm">
                    <span className="truncate">{member.name}</span>
                    {member.username ? (
                      <span className="truncate text-xs text-muted-foreground">@{member.username}</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            This project has no members to choose yet. Add them on the project&apos;s Members page.
          </p>
        )}

        <p
          id="hackathon-members-status"
          className={errors.memberIds ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {errors.memberIds ?? `${sizeHint} Each person can be on one team only.`}
        </p>
        {formerMembersNote(removedMembers) ? (
          <p className="text-xs text-muted-foreground">{formerMembersNote(removedMembers)}</p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Mindmap images</legend>
        <p className="text-xs text-muted-foreground">
          The global mindmap is required. PNG, JPEG or WebP, up to 5 MB each.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {IMAGE_SLOTS.map((slot, index) => (
            <ImageUpload
              key={`${projectId}-${slot.name}`}
              name={slot.name}
              label={index === 0 ? slot.label : `${slot.label} ${index}`}
              required={slot.required}
              hackathonId={hackathonId}
              projectId={projectId}
              value={slots[index]}
              onChange={(value) => {
                if (!acceptsUpload(value, hackathonId, live.current.projectId, live.current.open)) return;
                touched("images");
                setSlots((current) => current.map((s, i) => (i === index ? value : s)));
              }}
              onBusyChange={(busy) => onBusyChange(slot.name, busy)}
              disabled={!projectId}
            />
          ))}
        </div>
        {errors.images ? <p className="text-xs text-destructive">{errors.images}</p> : null}
      </fieldset>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ICON.planDoc className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{project?.doqtriStatus ?? NO_DOQTRI}</span>
      </p>
    </>
  );
}
