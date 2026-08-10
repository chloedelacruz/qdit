import { describe, expect, it } from "vitest";

import {
  DEPLOYMENT_STATUS,
  DEPLOYMENT_STATUS_ORDER,
  MILESTONE_OWNER_ONLY,
  MILESTONE_STATUS,
  MILESTONE_TRANSITIONS,
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  milestoneActionLabel,
  type MilestoneStatus,
} from "./constants";

/**
 * The milestone state machine is the one piece of TypeScript in this repo that
 * has an authoritative second implementation: `milestone_proof` in
 * contracts/milestone_proof/src/lib.rs enforces the same rules on chain, and
 * Postgres enforces none of them. If these two drift, the database ends up
 * holding a state the contract will refuse to reproduce, and nobody finds out
 * until the Soroban call is wired up.
 *
 * So each test below names the Rust function and test it mirrors. Read them as
 * a diff against the contract, not just as a check on a lookup table.
 *
 * The contract, restated:
 *
 *   submit_milestone_proof  writes Submitted from any status except Approved.
 *                           An unseen milestone is implicitly Proposed, so
 *                           Proposed -> Submitted and Rejected -> Submitted are
 *                           both legal; Approved -> Submitted is InvalidStatus.
 *   approve_milestone       Submitted -> Approved, approver == project owner.
 *   reject_milestone        Submitted -> Rejected, approver == project owner.
 *
 * Everything else errors.
 */

const ALL_STATUSES: MilestoneStatus[] = [
  "proposed",
  "submitted",
  "approved",
  "rejected",
];

describe("MILESTONE_TRANSITIONS", () => {
  it("allows proposed -> submitted and nothing else from proposed", () => {
    // Mirrors create_submit_approve_happy_path: submit_milestone_proof on a
    // milestone the contract has never seen writes Submitted.
    expect(MILESTONE_TRANSITIONS.proposed).toEqual(["submitted"]);
  });

  it("allows submitted -> approved and submitted -> rejected", () => {
    // Mirrors approve_milestone / reject_milestone, both of which require
    // record.status == Submitted.
    expect([...MILESTONE_TRANSITIONS.submitted].sort()).toEqual([
      "approved",
      "rejected",
    ]);
  });

  it("makes approved terminal", () => {
    // Mirrors approve_from_wrong_status_fails, which asserts that after an
    // approval a second approve, a reject and a re-submit all return
    // InvalidStatus. Nothing leaves Approved on chain, so nothing may leave it
    // here either.
    expect(MILESTONE_TRANSITIONS.approved).toEqual([]);
  });

  it("allows a rejected milestone to be re-submitted", () => {
    // Mirrors rejected_milestone_can_be_resubmitted. Note that the doc comment
    // on MilestoneStatus::Rejected in lib.rs calls Rejected "Terminal", but
    // submit_milestone_proof only refuses when the existing status is Approved,
    // and the Rust test asserts a rejected milestone accepts a second proof
    // hash. Behaviour, not the comment, is what the chain enforces — so
    // rejected -> submitted is legal, and this table is right.
    expect(MILESTONE_TRANSITIONS.rejected).toEqual(["submitted"]);
  });

  it("never lists a status as a transition out of itself", () => {
    // No-op transitions are handled by the `current === next` early return in
    // updateMilestoneStatus, not by the table.
    for (const status of ALL_STATUSES) {
      expect(MILESTONE_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("only ever targets a known status", () => {
    for (const status of ALL_STATUSES) {
      for (const next of MILESTONE_TRANSITIONS[status]) {
        expect(ALL_STATUSES).toContain(next);
      }
    }
  });

  it("covers every status as a source", () => {
    // A missing key would make MILESTONE_TRANSITIONS[current] undefined in
    // updateMilestoneStatus and throw on .includes().
    expect(Object.keys(MILESTONE_TRANSITIONS).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });

  /**
   * The exhaustive 4x4 grid. Written out by hand from the contract rather than
   * derived from MILESTONE_TRANSITIONS, so that changing the table without
   * changing the contract fails here.
   */
  const LEGAL_ON_CHAIN: Record<MilestoneStatus, MilestoneStatus[]> = {
    // submit_milestone_proof, unseen milestone == Proposed
    proposed: ["submitted"],
    // approve_milestone / reject_milestone
    submitted: ["approved", "rejected"],
    // every entry point returns InvalidStatus
    approved: [],
    // submit_milestone_proof again
    rejected: ["submitted"],
  };

  it.each(
    ALL_STATUSES.flatMap((from) =>
      ALL_STATUSES.filter((to) => to !== from).map((to) => ({
        from,
        to,
        legal: LEGAL_ON_CHAIN[from].includes(to),
      })),
    ),
  )("$from -> $to is legal: $legal", ({ from, to, legal }) => {
    expect(MILESTONE_TRANSITIONS[from].includes(to)).toBe(legal);
  });

  it("cannot reach approved without passing through submitted", () => {
    // The product rule the whole table exists for: no approving a milestone
    // whose proof was never submitted. approve_milestone reads the record and
    // returns MilestoneNotFound / InvalidStatus otherwise
    // (approve_before_submit_errors).
    for (const status of ALL_STATUSES) {
      if (status === "submitted") continue;
      expect(MILESTONE_TRANSITIONS[status]).not.toContain("approved");
    }
  });

  it("cannot reach rejected without passing through submitted", () => {
    for (const status of ALL_STATUSES) {
      if (status === "submitted") continue;
      expect(MILESTONE_TRANSITIONS[status]).not.toContain("rejected");
    }
  });
});

describe("MILESTONE_OWNER_ONLY", () => {
  it("reserves approve and reject to the project owner", () => {
    // Mirrors the `owner != approver -> NotAuthorized` check in transition(),
    // asserted by approve_by_non_owner_fails for both approve and reject.
    expect([...MILESTONE_OWNER_ONLY].sort()).toEqual(["approved", "rejected"]);
  });

  it("leaves submitting open to anyone with write access", () => {
    // submit_milestone_proof authenticates the submitter but never compares it
    // to the project owner — milestones_and_projects_are_namespaced has the
    // owner submitting to someone else's project and the builder submitting to
    // the owner's.
    expect(MILESTONE_OWNER_ONLY).not.toContain("submitted");
    expect(MILESTONE_OWNER_ONLY).not.toContain("proposed");
  });

  it("gates exactly the transitions that transition() handles", () => {
    // The owner-only set and the set of statuses reachable only from Submitted
    // are the same set on chain, because transition() is the only owner-gated
    // entry point.
    const ownerGated = new Set(MILESTONE_OWNER_ONLY);
    for (const next of MILESTONE_TRANSITIONS.submitted) {
      expect(ownerGated.has(next)).toBe(true);
    }
  });
});

describe("milestoneActionLabel", () => {
  it("reads as Submit for approval on a first submission", () => {
    expect(milestoneActionLabel("proposed", "submitted")).toBe(
      "Submit for approval",
    );
  });

  it("reads as Re-submit after a rejection", () => {
    expect(milestoneActionLabel("rejected", "submitted")).toBe("Re-submit");
  });

  it("labels the two owner-only decisions", () => {
    expect(milestoneActionLabel("submitted", "approved")).toBe("Approve");
    expect(milestoneActionLabel("submitted", "rejected")).toBe("Reject");
  });

  it("returns a non-empty label for every legal transition", () => {
    for (const from of ALL_STATUSES) {
      for (const to of MILESTONE_TRANSITIONS[from]) {
        expect(milestoneActionLabel(from, to).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("status display metadata", () => {
  it("labels every milestone status", () => {
    for (const status of ALL_STATUSES) {
      expect(MILESTONE_STATUS[status].label.length).toBeGreaterThan(0);
    }
  });

  it("tones approved as success and rejected as destructive", () => {
    // updateMilestoneStatus builds its error copy out of these labels, so a
    // renamed label changes user-facing error text.
    expect(MILESTONE_STATUS.approved.tone).toBe("success");
    expect(MILESTONE_STATUS.rejected.tone).toBe("destructive");
  });

  it("orders the board columns todo -> in progress -> done", () => {
    expect(TASK_STATUS_ORDER).toEqual(["todo", "in_progress", "done"]);
    for (const status of TASK_STATUS_ORDER) {
      expect(TASK_STATUS[status]).toBeDefined();
    }
  });

  it("orders the priority picker most-important first, and covers every value", () => {
    expect(TASK_PRIORITY_ORDER).toEqual(["urgent", "high", "medium", "low"]);
    expect([...TASK_PRIORITY_ORDER].sort()).toEqual(Object.keys(TASK_PRIORITY).sort());
  });

  it("numbers priority P0-first, against the enum's own order", () => {
    /**
     * The one thing here that is easy to get backwards, and silent when it is.
     *
     * `task_priority` is declared low → urgent in
     * 20260731135342_task_priority.sql, which is what makes Postgres sort it
     * correctly and what `listTasks` relies on when it orders descending. The
     * P-numbers run the other way, because P0 means the top one everywhere this
     * notation is used. Flipping them would leave every query, every filter and
     * every test passing while the board labelled urgent work "P3".
     */
    expect(TASK_PRIORITY.urgent.short).toBe("P0");
    expect(TASK_PRIORITY.high.short).toBe("P1");
    expect(TASK_PRIORITY.medium.short).toBe("P2");
    expect(TASK_PRIORITY.low.short).toBe("P3");
  });

  it("colours only the two priorities that are a signal", () => {
    // `medium` is the column default, so tinting it would tint essentially
    // every task in the database — and a scale where every step is coloured is
    // not a scale. PriorityChip declines to render medium at all for the same
    // reason.
    expect(TASK_PRIORITY.urgent.tone).toBe("destructive");
    expect(TASK_PRIORITY.high.tone).toBe("warning");
    expect(TASK_PRIORITY.medium.tone).toBe("neutral");
    expect(TASK_PRIORITY.low.tone).toBe("neutral");
  });

  it("gives every priority both a word and an abbreviation", () => {
    // The word is what the form, the facet and the detail panel say; the
    // abbreviation is the board chip and the screen-reader fallback for it.
    for (const priority of TASK_PRIORITY_ORDER) {
      expect(TASK_PRIORITY[priority].label.length).toBeGreaterThan(0);
      expect(TASK_PRIORITY[priority].short).toMatch(/^P[0-9]$/);
    }
  });

  it("orders the deployment pipeline and covers every status", () => {
    expect(DEPLOYMENT_STATUS_ORDER).toEqual([
      "not_started",
      "testnet",
      "ready_for_mainnet",
      "mainnet_live",
    ]);
    expect([...DEPLOYMENT_STATUS_ORDER].sort()).toEqual(
      Object.keys(DEPLOYMENT_STATUS).sort(),
    );
  });
});
