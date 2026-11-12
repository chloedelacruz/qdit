import { describe, expect, it } from "vitest";

import {
  checkImageFile,
  isMindmapPathFor,
  MAX_IMAGE_BYTES,
  mindmapPath,
  isSlidesUrl,
  mindmapUrlProblem,
  readSubmitForm,
  SLIDES_URL_MAX,
  submitEntrySchema,
  TEAM_NAME_MAX,
  uploadErrorMessage,
} from "./schemas";

const HACKATHON = "3f0c2a8e-1b4d-4c6e-9a7f-2d5b8e1c0a93";
const PROJECT = "7a9e4c21-5d3b-4f8a-b6c0-1e2d3f4a5b6c";
const OTHER_PROJECT = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const PEOPLE = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

const image = (n: number, project = PROJECT) =>
  mindmapPath(HACKATHON, project, `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`, "png");

const schema = submitEntrySchema({ teamMin: 3, teamMax: 4 });

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    hackathonId: HACKATHON,
    projectId: PROJECT,
    teamName: "Night Owls",
    memberIds: PEOPLE.slice(0, 3),
    images: [image(1), "", ""],
    slidesUrl: "https://docs.google.com/presentation/d/owls/edit",
    ...overrides,
  };
}

function errorsOf(input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe("submitEntrySchema: team size", () => {
  it.each([3, 4])("accepts %i members for a 3–4 team", (n) => {
    expect(schema.safeParse(entry({ memberIds: PEOPLE.slice(0, n) })).success).toBe(true);
  });

  it.each([0, 2, 5])("refuses %i members for a 3–4 team", (n) => {
    expect(errorsOf(entry({ memberIds: PEOPLE.slice(0, n) })).memberIds).toBe(
      "Choose 3 to 4 team members.",
    );
  });

  it("uses the hackathon's own bounds", () => {
    const pairs = submitEntrySchema({ teamMin: 2, teamMax: 2 });
    expect(pairs.safeParse(entry({ memberIds: PEOPLE.slice(0, 2) })).success).toBe(true);
    const three = pairs.safeParse(entry({ memberIds: PEOPLE.slice(0, 3) }));
    expect(three.success).toBe(false);
    expect(three.error?.issues[0].message).toBe("Choose 2 team members.");
  });

  it("refuses the same person twice", () => {
    expect(errorsOf(entry({ memberIds: [PEOPLE[0], PEOPLE[0], PEOPLE[1]] })).memberIds).toBe(
      "Each person can be on the team once.",
    );
  });

  it("refuses an id that is not a uuid", () => {
    expect(errorsOf(entry({ memberIds: ["ada", PEOPLE[1], PEOPLE[2]] })).memberIds).toBeTruthy();
  });
});

describe("submitEntrySchema: team name", () => {
  it("trims the name", () => {
    const result = schema.parse(entry({ teamName: "  Night Owls  " }));
    expect(result.teamName).toBe("Night Owls");
  });

  it.each(["", "   "])("refuses an empty name (%j)", (teamName) => {
    expect(errorsOf(entry({ teamName })).teamName).toBe("Enter a team name.");
  });

  it("accepts 80 characters and refuses 81", () => {
    expect(schema.safeParse(entry({ teamName: "x".repeat(TEAM_NAME_MAX) })).success).toBe(true);
    expect(errorsOf(entry({ teamName: "x".repeat(TEAM_NAME_MAX + 1) })).teamName).toBe(
      "Keep the team name to 80 characters.",
    );
  });
});

describe("submitEntrySchema: images", () => {
  it("needs the global mindmap in the first slot", () => {
    expect(errorsOf(entry({ images: ["", image(2), ""] })).images).toBe(
      "Attach the global mindmap image.",
    );
    expect(errorsOf(entry({ images: [] })).images).toBe("Attach the global mindmap image.");
  });

  it("takes one to three images, global map first, empty slots dropped", () => {
    expect(schema.parse(entry({ images: [image(1), "", ""] })).imagePaths).toEqual([image(1)]);
    expect(schema.parse(entry({ images: [image(1), "", image(3)] })).imagePaths).toEqual([
      image(1),
      image(3),
    ]);
    expect(schema.parse(entry({ images: [image(1), image(2), image(3)] })).imagePaths).toEqual([
      image(1),
      image(2),
      image(3),
    ]);
  });

  it("refuses a fourth image", () => {
    expect(errorsOf(entry({ images: [image(1), image(2), image(3), image(4)] })).images).toBe(
      "Attach at most three images.",
    );
  });

  it("refuses the same image twice", () => {
    expect(errorsOf(entry({ images: [image(1), image(1), ""] })).images).toBe(
      "Attach each image once.",
    );
  });

  it("refuses something that is not an upload path", () => {
    expect(errorsOf(entry({ images: ["https://example.com/map.png", "", ""] })).images).toBeTruthy();
  });

  it("refuses an image uploaded under another project", () => {
    expect(errorsOf(entry({ images: [image(1, OTHER_PROJECT), "", ""] })).images).toBe(
      "An image was uploaded for another project. Remove it and attach it again.",
    );
  });

  it("reports every field at once", () => {
    const errors = errorsOf(entry({ teamName: "", memberIds: [], images: [], slidesUrl: "" }));
    expect(Object.keys(errors).sort()).toEqual(["images", "memberIds", "slidesUrl", "teamName"]);
  });
});

describe("readSubmitForm", () => {
  it("reads the dialog's fields in slot order", () => {
    const form = new FormData();
    form.set("hackathonId", HACKATHON);
    form.set("projectId", PROJECT);
    form.set("teamName", "Night Owls");
    for (const id of PEOPLE.slice(0, 3)) form.append("memberIds", id);
    form.set("image_global", image(1));
    form.set("image_note_2", image(3));
    form.set("slidesUrl", " https://1drv.ms/p/s!Abc ");

    expect(readSubmitForm(form)).toEqual({
      hackathonId: HACKATHON,
      projectId: PROJECT,
      teamName: "Night Owls",
      memberIds: PEOPLE.slice(0, 3),
      images: [image(1), "", image(3)],
      slidesUrl: " https://1drv.ms/p/s!Abc ",
      mindmapUrl: "",
    });
  });

  it("reads a missing link as empty", () => {
    expect(readSubmitForm(new FormData()).slidesUrl).toBe("");
  });
});

describe("submitEntrySchema: Slides link (QDIT-63)", () => {
  it.each([
    "https://docs.google.com/presentation/d/1Nxqlqy11bYYONGM-ABCw0T56_NII05L4/edit?usp=sharing",
    "https://docs.google.com/presentation/u/1/d/abc/view",
    "https://docs.google.com/presentation/d/e/2PACX-1vQabc/pub?start=false",
    "https://DOCS.Google.com/presentation/d/abc/edit",
    "https://drive.google.com/file/d/1BdpwiyGm-_FyzfV2ttr0is/view?usp=sharing",
    "https://onedrive.live.com/edit?id=ABC123&resid=ABC123!101",
    "https://1drv.ms/p/s!AbCdEfGh",
    "https://contoso.sharepoint.com/:p:/s/team/EabCdEf?e=xyz",
    "https://contoso-my.sharepoint.com/personal/a_b/Documents/deck.pptx",
  ])("accepts %s, as hackathon_slides_url_ok() does", (url) => {
    expect(isSlidesUrl(url)).toBe(true);
    expect(schema.parse(entry({ slidesUrl: url })).slidesUrl).toBe(url);
  });

  it("stores the link trimmed", () => {
    const url = "https://docs.google.com/presentation/d/abc/edit";
    expect(schema.parse(entry({ slidesUrl: `  ${url}\n` })).slidesUrl).toBe(url);
  });

  it.each([
    ["", "Add the link to your slides."],
    ["   ", "Add the link to your slides."],
    ["http://docs.google.com/presentation/d/abc/edit", "Use the https:// link your slides app gives you."],
    ["docs.google.com/presentation/d/abc/edit", "Use the https:// link your slides app gives you."],
    ["https://docs.google.com/document/d/abc/edit", "Use a Google Slides or PowerPoint (OneDrive or SharePoint) link."],
    ["https://docs.google.com/presentation/", "Use a Google Slides or PowerPoint (OneDrive or SharePoint) link."],
    ["https://docs.google.com.example.com/presentation/d/abc", "Use a Google Slides or PowerPoint (OneDrive or SharePoint) link."],
    ["https://contoso.sharepoint.com@example.com/deck", "Use a Google Slides or PowerPoint (OneDrive or SharePoint) link."],
    ["https://drive.google.com/drive/folders/abc", "Use a Google Slides or PowerPoint (OneDrive or SharePoint) link."],
    ["https://example.com/deck.pptx", "Use a Google Slides or PowerPoint (OneDrive or SharePoint) link."],
    ["https://docs.google.com/presentation/d/abc/edit x", "Use a Google Slides or PowerPoint (OneDrive or SharePoint) link."],
    [`https://docs.google.com/presentation/d/abc/${"a".repeat(SLIDES_URL_MAX)}`, `Keep the link to ${SLIDES_URL_MAX} characters.`],
  ])("refuses %j", (url, message) => {
    expect(errorsOf(entry({ slidesUrl: url })).slidesUrl).toBe(message);
    expect(isSlidesUrl(url.trim())).toBe(false);
  });
});

describe("submitEntrySchema: Mindmap link (QDIT-66)", () => {
  const ORIGIN = "https://www.doqtri.xyz";
  const TOKEN = "Ab3_-xYz0123456789AbCd";
  const LINK = `${ORIGIN}/m/${TOKEN}`;
  const OFF = `Use a doqtri mindmap link: ${ORIGIN}/m/ followed by its code, with nothing after it.`;

  it("is optional: empty, blank or not posted at all is no link", () => {
    expect(schema.parse(entry({ mindmapUrl: "" })).mindmapUrl).toBe("");
    expect(schema.parse(entry({ mindmapUrl: "  " })).mindmapUrl).toBe("");
    expect(schema.parse(entry()).mindmapUrl).toBe("");
  });

  it("does not read DOQTRI_ORIGIN while the field is empty", () => {
    const strict = submitEntrySchema({ teamMin: 3, teamMax: 4 }, () => {
      throw new Error("not read");
    });
    expect(strict.parse(entry({ mindmapUrl: "" })).mindmapUrl).toBe("");
  });

  it("accepts a doqtri mindmap link, trimmed", () => {
    expect(schema.parse(entry({ mindmapUrl: ` ${LINK}\n` })).mindmapUrl).toBe(LINK);
    expect(schema.parse(entry({ mindmapUrl: `${ORIGIN}/m/${"z".repeat(64)}` })).mindmapUrl).toBe(`${ORIGIN}/m/${"z".repeat(64)}`);
  });

  it("follows the configured origin", () => {
    const staging = submitEntrySchema({ teamMin: 3, teamMax: 4 }, () => "https://staging.doqtri.xyz");
    expect(staging.parse(entry({ mindmapUrl: `https://staging.doqtri.xyz/m/${TOKEN}` })).mindmapUrl).toBe(
      `https://staging.doqtri.xyz/m/${TOKEN}`,
    );
    expect(staging.safeParse(entry({ mindmapUrl: LINK })).success).toBe(false);
  });

  it.each([
    [`http://www.doqtri.xyz/m/${TOKEN}`, "Use the https:// link doqtri gives you."],
    [`www.doqtri.xyz/m/${TOKEN}`, "Use the https:// link doqtri gives you."],
    [`https://other.example/m/${TOKEN}`, OFF],
    [`https://www.doqtri.xyz.evil.example/m/${TOKEN}`, OFF],
    [`${ORIGIN}/d/${TOKEN}`, OFF],
    [`${ORIGIN}/m/short`, OFF],
    [`${ORIGIN}/m/${"a".repeat(65)}`, OFF],
    [`${LINK}/`, OFF],
    [`${LINK}?x=1`, OFF],
    [`${LINK}#x`, OFF],
  ])("refuses %j with a field error", (url, message) => {
    expect(errorsOf(entry({ mindmapUrl: url })).mindmapUrl).toBe(message);
    expect(mindmapUrlProblem(url.trim(), ORIGIN)).toBe(message);
  });

  it("reports a bad link beside the other fields' problems", () => {
    const errors = errorsOf(entry({ teamName: "", mindmapUrl: "nope" }));
    expect(Object.keys(errors).sort()).toEqual(["mindmapUrl", "teamName"]);
  });
});

describe("checkImageFile (before upload)", () => {
  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
  ])("accepts %s as .%s", (type, ext) => {
    expect(checkImageFile({ type, size: 1024 })).toEqual({ ok: true, ext });
  });

  it.each(["image/gif", "image/svg+xml", "application/pdf", ""])("refuses %j", (type) => {
    expect(checkImageFile({ type, size: 1024 })).toEqual({
      ok: false,
      error: "Use a PNG, JPEG or WebP image.",
    });
  });

  it("accepts exactly 5 MB and refuses one byte more", () => {
    expect(checkImageFile({ type: "image/png", size: MAX_IMAGE_BYTES }).ok).toBe(true);
    expect(checkImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toEqual({
      ok: false,
      error: "The image is over 5 MB. Export a smaller one.",
    });
  });

  it("refuses an empty file", () => {
    expect(checkImageFile({ type: "image/png", size: 0 }).ok).toBe(false);
  });
});

describe("mindmapPath", () => {
  it("builds the bucket's <hackathon>/<project>/<uuid>.<ext> path", () => {
    const path = mindmapPath(HACKATHON, PROJECT, "AAAAAAAA-AAAA-4AAA-8AAA-000000000001", "png");
    expect(path).toBe(`${HACKATHON}/${PROJECT}/aaaaaaaa-aaaa-4aaa-8aaa-000000000001.png`);
    expect(isMindmapPathFor(path, HACKATHON, PROJECT)).toBe(true);
    expect(isMindmapPathFor(path, HACKATHON, OTHER_PROJECT)).toBe(false);
  });

  it("refuses extensions the bucket does not take", () => {
    expect(isMindmapPathFor(`${HACKATHON}/${PROJECT}/aaaaaaaa-aaaa-4aaa-8aaa-000000000001.gif`, HACKATHON, PROJECT)).toBe(false);
  });
});

describe("uploadErrorMessage", () => {
  it("explains a refusal by the bucket policy", () => {
    expect(uploadErrorMessage("new row violates row-level security policy")).toMatch(/owner or an admin/);
  });

  it("explains the size limit", () => {
    expect(uploadErrorMessage("The object exceeded the maximum allowed size")).toMatch(/over 5 MB/);
  });

  it("falls back to a retry", () => {
    expect(uploadErrorMessage("socket hang up")).toBe("The upload did not finish. Try again.");
  });
});
