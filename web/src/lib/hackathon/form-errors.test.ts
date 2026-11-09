import { describe, expect, it } from "vitest";

import type { ActionState } from "@/lib/actions";

import { markEdited, noEdits, visibleFieldErrors } from "./form-errors";

const failed: ActionState = {
  fieldErrors: {
    memberIds: "Choose 3 to 4 team members.",
    images: "Attach the global mindmap image.",
    teamName: "Enter a team name.",
  },
};

describe("submit dialog field errors", () => {
  it("shows every error of a fresh result", () => {
    expect(visibleFieldErrors(failed, noEdits({}))).toEqual(failed.fieldErrors);
  });

  it("hides a field's error as soon as that field changes, and keeps the others", () => {
    let edited = noEdits(failed);
    edited = markEdited(edited, failed, "memberIds");
    expect(visibleFieldErrors(failed, edited)).toEqual({
      images: "Attach the global mindmap image.",
      teamName: "Enter a team name.",
    });

    edited = markEdited(edited, failed, "images");
    expect(visibleFieldErrors(failed, edited)).toEqual({ teamName: "Enter a team name." });
  });

  it("hides several fields at once, as a project change does", () => {
    const edited = markEdited(noEdits(failed), failed, "projectId", "teamName", "memberIds", "images");
    expect(visibleFieldErrors(failed, edited)).toEqual({});
  });

  it("shows the next submit's errors again, even for fields edited before it", () => {
    const edited = markEdited(noEdits(failed), failed, "memberIds");
    const next: ActionState = { fieldErrors: { memberIds: "ada is already on another team in this hackathon." } };

    expect(visibleFieldErrors(next, edited)).toEqual(next.fieldErrors);
    // Editing after the new result starts from nothing edited.
    const after = markEdited(edited, next, "teamName");
    expect([...after.fields]).toEqual(["teamName"]);
    expect(visibleFieldErrors(next, after)).toEqual(next.fieldErrors);
  });

  it("shows nothing for a result with no field errors", () => {
    expect(visibleFieldErrors({ ok: true }, noEdits({}))).toEqual({});
  });
});
