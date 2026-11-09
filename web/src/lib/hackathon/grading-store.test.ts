import { describe, expect, it, vi } from "vitest";

import {
  imageFromBlob,
  MAX_IMAGE_BYTES,
  toClaimedJob,
  toVersionProgress,
  type ClaimRow,
} from "@/lib/hackathon/grading-store";
import { doqtriSnapshot, qditSnapshot } from "@/test/hackathon-fixtures";

describe("imageFromBlob", () => {
  it("refuses a map over 5 MB before reading its bytes", async () => {
    const blob = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: "image/png" });
    const arrayBuffer = vi.spyOn(blob, "arrayBuffer");
    await expect(imageFromBlob("g.png", blob)).resolves.toEqual({ ok: false, reason: "too_large" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("refuses an empty object and an unsupported type", async () => {
    await expect(imageFromBlob("g.png", new Blob([]))).resolves.toEqual({ ok: false, reason: "unreadable" });
    await expect(imageFromBlob("g.gif", new Blob([new Uint8Array(4)], { type: "image/gif" }))).resolves.toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("reads an allowed map as base64, typed by the object or else the extension", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(imageFromBlob("g.png", new Blob([bytes], { type: "image/png" }))).resolves.toEqual({
      ok: true,
      image: { mediaType: "image/png", base64: "AQID" },
    });
    await expect(imageFromBlob("g.JPG", new Blob([bytes]))).resolves.toMatchObject({
      ok: true,
      image: { mediaType: "image/jpeg" },
    });
  });
});

describe("toClaimedJob", () => {
  const row: ClaimRow = {
    job_id: "j1",
    version_id: "v1",
    run_no: 1,
    attempts: 2,
    lease_until: "2026-11-21T17:04:20+00:00",
    submission_id: "s1",
    hackathon_id: "h1",
    project_id: "p1",
    team_name: "Team",
    member_ids: ["u1"],
    image_paths: ["h1/p1/a.png"],
    submitted_at: "2026-11-21T17:00:00+00:00",
    qdit_snapshot: qditSnapshot(),
    doqtri_snapshot: doqtriSnapshot(),
    opens_at: "2026-11-20T09:00:00+00:00",
    closes_at: "2026-11-21T17:00:00+00:00",
    team_min: 3,
    team_max: 4,
    current_version_id: "v1",
    eligibility_override: null,
    eligibility: { eligible: true, rules: [] },
  };

  it("maps the claim row, the new context columns included", () => {
    expect(toClaimedJob(row)).toMatchObject({
      jobId: "j1",
      attempts: 2,
      currentVersionId: "v1",
      eligibilityOverride: null,
      storedEligibility: { eligible: true, rules: [] },
      window: { opens_at: row.opens_at, closes_at: row.closes_at, team_min: 3, team_max: 4 },
    });
    expect(toClaimedJob({ ...row, eligibility: null, eligibility_override: false })).toMatchObject({
      storedEligibility: null,
      eligibilityOverride: false,
    });
  });

  it("refuses a snapshot of the wrong shape", () => {
    expect(() => toClaimedJob({ ...row, qdit_snapshot: { schema_version: 2 } })).toThrow(/qdit snapshot/);
    expect(() => toClaimedJob({ ...row, doqtri_snapshot: { notes: "x" } })).toThrow(/doqtri snapshot/);
  });
});

describe("toVersionProgress", () => {
  it("maps hackathon_version_progress()", () => {
    const criteria = { clarity: { score: 5, evidence: "e" } };
    expect(
      toVersionProgress({
        version_id: "v1",
        jobs: [
          { id: "j1", run_no: 1, status: "done" },
          { id: "j2", run_no: 2, status: "failed" },
        ],
        runs: [{ run_no: 1, criteria, total: "55.00", flags: ["off_topic"], model: "m" }],
      }),
    ).toEqual({
      jobs: [
        { runNo: 1, status: "done" },
        { runNo: 2, status: "failed" },
      ],
      runs: [{ runNo: 1, criteria, total: 55, flags: ["off_topic"] }],
    });
  });

  it("refuses an unexpected shape", () => {
    expect(() => toVersionProgress(null)).toThrow();
    expect(() => toVersionProgress({ jobs: [{ run_no: 1, status: "weird" }], runs: [] })).toThrow();
  });
});
