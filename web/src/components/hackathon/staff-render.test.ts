import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The admin and staff components (WP-4.7, QDIT-48), rendered to markup:
 * the Override control is gone after release, and every team name, project
 * slug and username goes through toPlainText, so a bidi override or a
 * control character a team typed never reaches the page.
 */
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { StaffSubmissionActions } = await import("@/components/hackathon/staff-submission-actions");
const { StaffSubmissionsTable } = await import("@/components/hackathon/staff-submissions-table");
const { StaffLeaderboard } = await import("@/components/hackathon/staff-leaderboard");
const { StaffPitchOrder } = await import("@/components/hackathon/staff-pitch-order");
const { StaffPanel } = await import("@/components/hackathon/staff-panel");
const { TooltipProvider } = await import("@/components/ui/tooltip");

const H = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
/** RIGHT-TO-LEFT OVERRIDE and BEL: stripped by toPlainText. */
const EVIL = "Team‮gnp.exe\u0007";
const CLEAN = "Teamgnp.exe";

/** Inside the provider the app shell gives every page. */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(createElement(TooltipProvider, null, el));

function expectClean(markup: string) {
  expect(markup).not.toContain("‮");
  expect(markup).not.toContain("\u0007");
}

const actionsProps = {
  hackathonId: H,
  submissionId: S,
  projectId: "33333333-3333-4333-8333-333333333333",
  teamName: EVIL,
  override: null,
  overrideReason: null,
  latePassUntil: null,
  closesAt: "2026-11-10T02:25:00Z",
};

describe("StaffSubmissionActions", () => {
  it("offers Override, Regrade and Late pass before release", () => {
    const markup = html(createElement(StaffSubmissionActions, { ...actionsProps, released: false }));
    expect(markup).toContain(">Override<");
    expect(markup).toContain(">Regrade<");
    expect(markup).toContain(">Late pass<");
  });

  it("hides Override after release", () => {
    const markup = html(createElement(StaffSubmissionActions, { ...actionsProps, released: true }));
    expect(markup).not.toContain("Override");
    expect(markup).toContain("Grades are released; finalists are fixed.");
  });
});

describe("team content goes through toPlainText", () => {
  it("in the admin submissions table", () => {
    const markup = html(
      createElement(StaffSubmissionsTable, {
        slug: "manila-26",
        hackathonId: H,
        closesAt: "2026-11-10T02:25:00Z",
        released: false,
        rows: [
          {
            submission_id: S,
            project_id: "p",
            project_slug: "proj‮slug",
            team_name: EVIL,
            version_no: 1,
            submitted_at: "2026-11-10T02:20:00Z",
            jobs: [],
            complete: false,
            eligibility: null,
            eligibility_override: null,
            override_reason: null,
            late_pass_until: null,
          },
        ],
      }),
    );
    expectClean(markup);
    expect(markup).toContain(CLEAN);
    expect(markup).toContain("projslug");
  });

  it("in the leaderboard, including the manipulation banner", () => {
    const markup = html(
      createElement(StaffLeaderboard, {
        slug: "manila-26",
        rows: [
          {
            submission_id: S,
            eligible: true,
            ai_total: 80,
            submitted_at: "2026-11-10T02:20:00Z",
            finalist: true,
            team_name: EVIL,
            project_slug: "proj‮slug",
            flags: ["manipulation"],
            final_rank: 1,
            human_mean: null,
            judge_count: 0,
            version_no: 1,
            ai_rank: 1,
            pitch_order: null,
            ai_mean: 80,
            run_count: 2,
            ai_criteria: null,
            spread: 0,
            judge_mean: null,
          },
        ],
      }),
    );
    expectClean(markup);
    expect(markup).toContain("Possible manipulation.");
    expect(markup.split(CLEAN).length - 1).toBe(2);
  });

  it("in the pitch order editor, labels included", () => {
    const markup = html(
      createElement(StaffPitchOrder, { hackathonId: H, finalists: [{ submission_id: S, team_name: EVIL }] }),
    );
    expectClean(markup);
    expect(markup).toContain(`Move ${CLEAN} up`);
  });

  it("in the staff panel", () => {
    const markup = html(
      createElement(StaffPanel, {
        hackathonId: H,
        currentUserId: "me",
        staff: [{ user_id: "u1", username: "ana‮", display_name: "Ana\u0007 R", role: "admin" }],
      }),
    );
    expectClean(markup);
    expect(markup).toContain("@ana");
    expect(markup).toContain("Ana R");
  });
});
