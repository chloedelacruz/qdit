"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Field, FormDialog, SelectField } from "@/components/form-dialog";
import { DisabledReason } from "@/components/hint";
import { EntryCheckPanel } from "@/components/hackathon/entry-check-panel";
import { ImageUpload, type SlotValue } from "@/components/hackathon/image-upload";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/actions";
import { DEFAULT_DOQTRI_ORIGIN } from "@/lib/doqtri-origin";
import {
  clearDraft,
  draftStorage,
  readDraft,
  saveDraft,
  startingMindmapUrl,
  typedMindmapUrl,
  usableDraft,
  type DraftBase,
} from "@/lib/hackathon/draft";
import { checkHackathonEntry, submitHackathonEntry } from "@/lib/hackathon/actions";
import { checkThenSubmit, SUBMIT_ANYWAY } from "@/lib/hackathon/check-then-submit";
import { markEdited, noEdits, visibleFieldErrors } from "@/lib/hackathon/form-errors";
import { acceptsUpload, formerMembersNote, rosterMembers } from "@/lib/hackathon/team";
import { IMAGE_SLOTS, MINDMAP_BUCKET, TEAM_NAME_MAX } from "@/lib/hackathon/schemas";
import { createClient } from "@/lib/supabase/client";
import { ICON } from "@/lib/icons";

/** One project the caller may submit, as the page hands it over. */
export type SubmitProject = {
  id: string;
  name: string;
  members: { id: string; name: string; username: string | null }[];
  /** A short line about the latest doqtri snapshot, already worded by the page. */
  doqtriStatus: string | null;
  /** The newest doqtri snapshot's mindmap link (QDIT-66), which the Mindmap link field starts from. */
  snapshotMindmapUrl: string | null;
  /** What the entry holds now, to start from on an update. */
  entry: {
    teamName: string;
    memberIds: string[];
    images: { path: string; url: string | null }[];
    /** The submitted Slides link; null on a version from before QDIT-63. */
    slidesUrl: string | null;
    /** The submitted Mindmap link; null for none (QDIT-66). */
    mindmapUrl: string | null;
    /** When the current version was submitted; an older draft is dropped. */
    submittedAt: string | null;
  } | null;
};

/** Long enough for a dialog left open while the team works; the server uses the same. */
const SIGNED_PREVIEW_SECONDS = 600;

const NO_DOQTRI =
  "No doqtri snapshot yet. In doqtri, open the global mindmap and use Send to qdit hackathon.";

/** The Mindmap link's hint while it shows the newest snapshot's link (QDIT-66). */
export const MINDMAP_FROM_SNAPSHOT_HINT = "Filled from your latest Send in doqtri";

/**
 * "Add submission to hackathon" (WP-4.7, QDIT-47, D-115).
 *
 * The trigger is the page's primary action. It stays visible and disabled,
 * with the reason, when there is nothing the caller can submit right now
 * (spec §Explainers and disabled controls).
 */
export function SubmitForm({
  userId,
  hackathonId,
  teamMin,
  teamMax,
  projects,
  label,
  disabledReason,
  autoOpen = false,
  doqtriOrigin = DEFAULT_DOQTRI_ORIGIN,
}: {
  /** The signed-in user: drafts are kept per person (QDIT-62). */
  userId: string;
  hackathonId: string;
  teamMin: number;
  teamMax: number;
  /** Projects the caller is owner or admin of, open for submitting now. */
  projects: SubmitProject[];
  label: string;
  /** Set when the button cannot be used; shown as its tooltip. */
  disabledReason: string | null;
  /** Open on arrival: `?submit=1`, from the Hackathons index (QDIT-50). */
  autoOpen?: boolean;
  /** `DOQTRI_ORIGIN`, for the Mindmap link's placeholder only; the server checks the link. */
  doqtriOrigin?: string;
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
      const result = await checkThenSubmit(prev, formData, {
        check: checkHackathonEntry,
        submit: submitHackathonEntry,
      });
      // Submitted: the draft has done its job (QDIT-62).
      const projectId = formData.get("projectId");
      if (result.ok && typeof projectId === "string") {
        clearDraft(draftStorage(), { userId, hackathonId, projectId });
      }
      return result;
    },
    [userId, hackathonId],
  );

  const trigger = (
    <Button size="sm">
      <ICON.send data-icon="inline-start" />
      {label}
    </Button>
  );

  // A new FormDialog per opening: its action state (and so every error from
  // the last attempt) starts empty each time the dialog opens.
  const canOpen = !disabledReason && projects.length > 0;
  const [open, setOpen] = useState(() => autoOpen && canOpen);
  const [opening, setOpening] = useState(() => (autoOpen && canOpen ? 1 : 0));

  // Drop `?submit=1` once it has done its job, so a reload or a shared link
  // doesn't reopen the dialog. No state is set here.
  useEffect(() => {
    if (!autoOpen) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("submit")) return;
    url.searchParams.delete("submit");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [autoOpen]);
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
      description="Your qdit project, your latest doqtri snapshot, these images and your links are saved together as one submission. Changes you haven't submitted stay in this browser as a draft."
      submitLabel={(state) => (state.entryCheck ? "Check again" : "Submit")}
      successMessage="Submission received."
      action={action}
      singleSubmit
      extraActions={(state, busy) =>
        state.entryCheck ? (
          <Button
            type="submit"
            name={SUBMIT_ANYWAY}
            value="1"
            variant="outline"
            disabled={busy}
            className="pointer-coarse:h-11"
          >
            Submit anyway
          </Button>
        ) : null
      }
      // Wide enough for the checklist beside the fields once it shows.
      className={(state) => (state.entryCheck ? "sm:max-w-lg lg:max-w-5xl" : "sm:max-w-lg")}
    >
      {(state) => (
        <SubmitFields
          state={state}
          userId={userId}
          hackathonId={hackathonId}
          teamMin={teamMin}
          teamMax={teamMax}
          projects={projects}
          onBusyChange={onBusyChange}
          doqtriOrigin={doqtriOrigin}
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

/** The submitted entry, as a draft is compared against it. */
function draftBase(project: SubmitProject | undefined): DraftBase {
  const entry = project?.entry;
  if (!entry) return null;
  return {
    teamName: entry.teamName,
    memberIds: entry.memberIds,
    imagePaths: entry.images.map((image) => image.path),
    slidesUrl: entry.slidesUrl,
    mindmapUrl: entry.mindmapUrl,
    submittedAt: entry.submittedAt,
  };
}

/** What the Mindmap link field shows while the team has not typed one (QDIT-66). */
function mindmapStart(project: SubmitProject | undefined): string {
  return startingMindmapUrl(project?.snapshotMindmapUrl ?? null, draftBase(project));
}

/**
 * What the fields start from for a project: its unsent draft when this
 * browser holds one (QDIT-62), else its submitted entry, else empty.
 * `toSign` lists the draft's image paths that still need a preview URL.
 */
function startFor(project: SubmitProject | undefined, userId: string, hackathonId: string) {
  const fromEntry = {
    teamName: project?.entry?.teamName ?? null,
    slidesUrl: project?.entry?.slidesUrl ?? "",
    mindmapUrl: mindmapStart(project),
    team: startingTeam(project),
    slots: initialSlots(project),
    restored: false,
    toSign: [] as string[],
  };
  if (!project) return fromEntry;

  const draft = usableDraft(
    readDraft(draftStorage(), { userId, hackathonId, projectId: project.id }),
    draftBase(project),
  );
  if (!draft) return fromEntry;

  // An image the entry already shows keeps its signed URL.
  const signed = new Map((project.entry?.images ?? []).map((image) => [image.path, image.url]));
  const slots = draft.imagePaths.map((path) =>
    path ? { path, previewUrl: signed.get(path) ?? null } : null,
  );
  return {
    teamName: draft.teamName,
    slidesUrl: draft.slidesUrl,
    // Untouched in the draft: the newest snapshot's link, as of this opening.
    mindmapUrl: draft.mindmapUrl ?? mindmapStart(project),
    team: rosterMembers(draft.memberIds, project.members),
    slots,
    restored: true,
    toSign: draft.imagePaths.filter((path): path is string => path !== null && !signed.has(path)),
  };
}

/**
 * The dialog's body. Mounted each time the dialog opens, so it starts from the
 * chosen project's current entry every time.
 */
function SubmitFields({
  state,
  userId,
  hackathonId,
  teamMin,
  teamMax,
  projects,
  onBusyChange,
  doqtriOrigin,
}: {
  state: ActionState;
  userId: string;
  hackathonId: string;
  teamMin: number;
  teamMax: number;
  projects: SubmitProject[];
  onBusyChange: (slot: string, busy: boolean) => void;
  doqtriOrigin: string;
}) {
  const [projectId, setProjectId] = useState(
    () => (projects.find((p) => p.entry) ?? projects[0])?.id ?? "",
  );
  const project = projects.find((p) => p.id === projectId);

  // Read once per opening; every setter below starts from it.
  const [start] = useState(() => startFor(project, userId, hackathonId));
  const [teamName, setTeamName] = useState(start.teamName ?? "");
  const [slidesUrl, setSlidesUrl] = useState(start.slidesUrl);
  const [mindmapUrl, setMindmapUrl] = useState(start.mindmapUrl);
  const [memberIds, setMemberIds] = useState<string[]>(start.team.kept);
  const [removedMembers, setRemovedMembers] = useState(start.team.removed);
  const [slots, setSlots] = useState(start.slots);
  // Which project's fields came back from a draft, for the "Draft restored" line.
  const [restoredFor, setRestoredFor] = useState<string | null>(start.restored ? projectId : null);
  const [toSign, setToSign] = useState(start.toSign);

  // Keep what the fields say as the project's draft, or drop the draft once
  // they match the submitted entry again (QDIT-62). Paths only: a preview URL
  // expires, and a blob: one dies with the page.
  // The Mindmap link is kept only when typed (QDIT-66): one that says what
  // the field shows by itself stays untouched, so the next opening follows
  // the newest snapshot again.
  const mindmapStarting = mindmapStart(project);
  const mindmapTyped = typedMindmapUrl(mindmapUrl, mindmapStarting);
  useEffect(() => {
    if (!projectId) return;
    saveDraft(
      draftStorage(),
      { userId, hackathonId, projectId },
      {
        teamName,
        memberIds,
        imagePaths: slots.map((slot) => slot?.path ?? null),
        slidesUrl,
        mindmapUrl: mindmapTyped,
      },
      draftBase(project),
    );
  }, [userId, hackathonId, projectId, project, teamName, memberIds, slots, slidesUrl, mindmapTyped]);

  // A restored image needs a fresh preview URL. A path Storage refuses to sign
  // (the object is gone, or it is not this project's) is dropped from its slot;
  // a request that fails outright leaves the slot as "Attached".
  useEffect(() => {
    if (toSign.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await createClient()
          .storage.from(MINDMAP_BUCKET)
          .createSignedUrls(toSign, SIGNED_PREVIEW_SECONDS);
        if (cancelled || error || !data) return;
        const urls = new Map<string, string | null>();
        for (const item of data) {
          if (item.path) urls.set(item.path, item.error || !item.signedUrl ? null : item.signedUrl);
        }
        setSlots((current) =>
          current.map((slot) => {
            if (!slot || !urls.has(slot.path)) return slot;
            const url = urls.get(slot.path);
            return url ? { ...slot, previewUrl: url } : null;
          }),
        );
      } catch {
        // Offline or similar: the slot stays attached without a preview.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toSign]);

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
    touched("projectId", "teamName", "memberIds", "images", "slidesUrl", "mindmapUrl");
    // Images are stored under the project, so they never carry over.
    const from = startFor(next, userId, hackathonId);
    setTeamName(from.teamName ?? teamName);
    // Like the team name: a link typed before switching is kept for a new entry.
    setSlidesUrl(next?.entry || from.restored ? from.slidesUrl : slidesUrl);
    // Unlike the Slides link, never carried over: it names this project's map.
    setMindmapUrl(from.mindmapUrl);
    setMemberIds(from.team.kept);
    setRemovedMembers(from.team.removed);
    setSlots(from.slots);
    setRestoredFor(from.restored ? id : null);
    setToSign(from.toSign);
  }

  /** Back to the submitted entry (or empty); the save effect then drops the draft. */
  function discardDraft() {
    touched("teamName", "memberIds", "images", "slidesUrl", "mindmapUrl");
    clearDraft(draftStorage(), { userId, hackathonId, projectId });
    setTeamName(project?.entry?.teamName ?? "");
    setSlidesUrl(project?.entry?.slidesUrl ?? "");
    setMindmapUrl(mindmapStart(project));
    const team = startingTeam(project);
    setMemberIds(team.kept);
    setRemovedMembers(team.removed);
    setSlots(initialSlots(project));
    setRestoredFor(null);
    setToSign([]);
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

  const check = state.entryCheck;

  // Below `lg` the checklist lands under the fields, out of sight: bring it
  // into view when a check comes back.
  const checkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!check) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    checkRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [check]);

  return (
    <div
      className={
        check
          ? "space-y-3.5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start lg:gap-6 lg:space-y-0"
          : "space-y-3.5"
      }
    >
      <div className="space-y-3.5">
        <input type="hidden" name="hackathonId" value={hackathonId} />

        {restoredFor === projectId ? (
          <div className="well flex items-center justify-between gap-2 rounded-lg border border-border py-1 pr-1 pl-2.5">
            <p className="text-xs text-muted-foreground">
              Draft restored from this browser. It is not submitted yet.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 pointer-coarse:h-9"
              onClick={discardDraft}
            >
              Discard draft
            </Button>
          </div>
        ) : null}

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

        <Field id="hackathon-slides-url" label="Slides link" error={errors.slidesUrl}>
          <Input
            id="hackathon-slides-url"
            name="slidesUrl"
            type="url"
            inputMode="url"
            value={slidesUrl}
            onChange={(event) => {
              touched("slidesUrl");
              setSlidesUrl(event.target.value);
            }}
            // No maxLength: a cut-off link could still look valid. The schema says it is too long.
            placeholder="https://docs.google.com/presentation/d/…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errors.slidesUrl ? true : undefined}
            aria-describedby={
              errors.slidesUrl ? "hackathon-slides-url-error hackathon-slides-url-hint" : "hackathon-slides-url-hint"
            }
          />
          <p id="hackathon-slides-url-hint" className="text-xs text-muted-foreground">
            Google Slides or PowerPoint (OneDrive or SharePoint). Set sharing to{" "}
            <span className="font-medium text-foreground">Anyone with the link can view</span>, or the
            organisers can&apos;t open it.
          </p>
        </Field>

        <Field id="hackathon-mindmap-url" label="Mindmap link" optional error={errors.mindmapUrl}>
          <Input
            id="hackathon-mindmap-url"
            name="mindmapUrl"
            type="url"
            inputMode="url"
            value={mindmapUrl}
            onChange={(event) => {
              touched("mindmapUrl");
              setMindmapUrl(event.target.value);
            }}
            placeholder={`${doqtriOrigin}/m/…`}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errors.mindmapUrl ? true : undefined}
            aria-describedby={
              errors.mindmapUrl
                ? "hackathon-mindmap-url-error hackathon-mindmap-url-hint"
                : "hackathon-mindmap-url-hint"
            }
          />
          <p id="hackathon-mindmap-url-hint" className="text-xs text-muted-foreground">
            {mindmapTyped === null && project?.snapshotMindmapUrl
              ? MINDMAP_FROM_SNAPSHOT_HINT
              : "Send to qdit hackathon in doqtri fills this in. You can also paste the mindmap link doqtri gives you."}
          </p>
        </Field>

        {/* The checklist says which doqtri snapshot it read, so this line would repeat it. */}
        {check ? null : (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ICON.planDoc className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{project?.doqtriStatus ?? NO_DOQTRI}</span>
          </p>
        )}
      </div>

      {/* Beside the fields from `lg`, and kept in view while they scroll;
          below the fields on smaller screens. */}
      {check ? (
        <div ref={checkRef} className="lg:sticky lg:top-0">
          <EntryCheckPanel check={check} />
        </div>
      ) : null}
    </div>
  );
}
