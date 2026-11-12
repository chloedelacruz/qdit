import { describe, expect, it } from "vitest";

import {
  baseFields,
  clearDraft,
  draftKey,
  parseDraft,
  prefillableMindmapUrl,
  readDraft,
  sameAsBase,
  saveDraft,
  startingMindmapUrl,
  typedMindmapUrl,
  usableDraft,
  type DraftBase,
} from "./draft";
import { mindmapPath, SLIDES_URL_MAX, TEAM_NAME_MAX } from "./schemas";

const USER = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const ADA = "11111111-1111-4111-8111-111111111111";
const LIN = "22222222-2222-4222-8222-222222222222";
const HACKATHON = "3f0c2a8e-1b4d-4c6e-9a7f-2d5b8e1c0a93";
const PROJECT = "7a9e4c21-5d3b-4f8a-b6c0-1e2d3f4a5b6c";
const OTHER = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
const IDS = { userId: USER, hackathonId: HACKATHON, projectId: PROJECT };

const GLOBAL = mindmapPath(HACKATHON, PROJECT, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "png");
const NOTE = mindmapPath(HACKATHON, PROJECT, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "webp");
const FOREIGN = mindmapPath(HACKATHON, OTHER, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "png");
const DECK = "https://docs.google.com/presentation/d/owls-deck/edit";
const MAP_V1 = "https://www.doqtri.xyz/m/Version1Token_abcdefgh";
const MAP_SENT = "https://www.doqtri.xyz/m/LatestSendToken_abcdefg";

const ENTRY: DraftBase = {
  teamName: "Night Owls",
  memberIds: [ADA, LIN],
  imagePaths: [GLOBAL],
  slidesUrl: DECK,
  mindmapUrl: MAP_V1,
  submittedAt: "2026-11-12T02:00:00.000Z",
};
const SUBMITTED_MS = Date.parse("2026-11-12T02:00:00.000Z");

/** An in-memory Storage, optionally one that refuses every call. */
function memoryStorage({ broken = false } = {}): Storage {
  const items = new Map<string, string>();
  const guard = () => {
    if (broken) throw new DOMException("blocked", "SecurityError");
  };
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => (guard(), items.get(key) ?? null),
    setItem: (key, value) => (guard(), void items.set(key, value)),
    removeItem: (key) => (guard(), void items.delete(key)),
    clear: () => items.clear(),
  };
}

describe("draftKey", () => {
  it("is separate per user, hackathon and project", () => {
    const keys = new Set([
      draftKey(USER, HACKATHON, PROJECT),
      draftKey(ADA, HACKATHON, PROJECT),
      draftKey(USER, OTHER, PROJECT),
      draftKey(USER, HACKATHON, OTHER),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe("baseFields and sameAsBase", () => {
  it("start from the submitted entry, one image entry per slot", () => {
    expect(baseFields(ENTRY)).toEqual({
      teamName: "Night Owls",
      memberIds: [ADA, LIN],
      imagePaths: [GLOBAL, null, null],
      slidesUrl: DECK,
      mindmapUrl: null,
    });
  });

  it("start empty without an entry", () => {
    expect(baseFields(null)).toEqual({
      teamName: "",
      memberIds: [],
      imagePaths: [null, null, null],
      slidesUrl: "",
      mindmapUrl: null,
    });
  });

  it("start with an empty link for a version from before the link existed", () => {
    expect(baseFields({ ...ENTRY!, slidesUrl: null }).slidesUrl).toBe("");
  });

  it("ignore member order but not image slots", () => {
    expect(sameAsBase({ ...baseFields(ENTRY), memberIds: [LIN, ADA] }, ENTRY)).toBe(true);
    expect(sameAsBase({ ...baseFields(ENTRY), imagePaths: [null, GLOBAL, null] }, ENTRY)).toBe(false);
  });

  it("compare the team name as the submit stores it, trimmed", () => {
    expect(sameAsBase({ ...baseFields(ENTRY), teamName: " Night Owls " }, ENTRY)).toBe(true);
  });

  it("compare the Slides link trimmed too", () => {
    expect(sameAsBase({ ...baseFields(ENTRY), slidesUrl: ` ${DECK} ` }, ENTRY)).toBe(true);
  });

  it("see any changed field", () => {
    expect(sameAsBase({ ...baseFields(ENTRY), teamName: "Night Owls 2" }, ENTRY)).toBe(false);
    expect(sameAsBase({ ...baseFields(ENTRY), memberIds: [ADA] }, ENTRY)).toBe(false);
    expect(sameAsBase({ ...baseFields(ENTRY), imagePaths: [GLOBAL, NOTE, null] }, ENTRY)).toBe(false);
    expect(sameAsBase({ ...baseFields(ENTRY), slidesUrl: `${DECK}?slide=2` }, ENTRY)).toBe(false);
  });
});

describe("parseDraft", () => {
  const stored = (value: unknown) => JSON.stringify(value);

  it("reads a well-formed draft", () => {
    const raw = stored({
      teamName: "Owls",
      memberIds: [ADA],
      imagePaths: [GLOBAL, null, NOTE],
      slidesUrl: DECK,
      mindmapUrl: MAP_V1,
      savedAt: 5,
    });
    expect(parseDraft(raw, HACKATHON, PROJECT)).toEqual({
      teamName: "Owls",
      memberIds: [ADA],
      imagePaths: [GLOBAL, null, NOTE],
      slidesUrl: DECK,
      mindmapUrl: MAP_V1,
      savedAt: 5,
    });
  });

  it("reads a draft saved before the Slides link existed with an empty link", () => {
    const raw = stored({ teamName: "Owls", memberIds: [], imagePaths: [], savedAt: 5 });
    expect(parseDraft(raw, HACKATHON, PROJECT)?.slidesUrl).toBe("");
  });

  it("keeps a half-typed link as typed, capped just past the limit", () => {
    const raw = (slidesUrl: string) => stored({ teamName: "", memberIds: [], imagePaths: [], slidesUrl, savedAt: 1 });
    expect(parseDraft(raw("https://docs.goo"), HACKATHON, PROJECT)?.slidesUrl).toBe("https://docs.goo");
    expect(parseDraft(raw("x".repeat(SLIDES_URL_MAX + 50)), HACKATHON, PROJECT)?.slidesUrl).toHaveLength(SLIDES_URL_MAX + 1);
  });

  it("treats anything malformed as no draft", () => {
    expect(parseDraft(null, HACKATHON, PROJECT)).toBeNull();
    expect(parseDraft("{not json", HACKATHON, PROJECT)).toBeNull();
    expect(parseDraft(stored([]), HACKATHON, PROJECT)).toBeNull();
    expect(parseDraft(stored({ teamName: 1, memberIds: [], imagePaths: [], savedAt: 1 }), HACKATHON, PROJECT)).toBeNull();
    expect(parseDraft(stored({ teamName: "", memberIds: [1], imagePaths: [], savedAt: 1 }), HACKATHON, PROJECT)).toBeNull();
    expect(parseDraft(stored({ teamName: "", memberIds: [], imagePaths: [] }), HACKATHON, PROJECT)).toBeNull();
    expect(parseDraft(stored({ teamName: "", memberIds: [], imagePaths: [], slidesUrl: 3, savedAt: 1 }), HACKATHON, PROJECT)).toBeNull();
    expect(parseDraft(stored({ teamName: "", memberIds: [], imagePaths: [], mindmapUrl: 3, savedAt: 1 }), HACKATHON, PROJECT)).toBeNull();
  });

  it("drops an image path for another project and pads the slots", () => {
    const raw = stored({ teamName: "", memberIds: [], imagePaths: [FOREIGN, 7], savedAt: 1 });
    expect(parseDraft(raw, HACKATHON, PROJECT)?.imagePaths).toEqual([null, null, null]);
  });

  it("caps the team name and removes repeated members", () => {
    const raw = stored({ teamName: "x".repeat(TEAM_NAME_MAX + 10), memberIds: [ADA, ADA, LIN], imagePaths: [], savedAt: 1 });
    const draft = parseDraft(raw, HACKATHON, PROJECT);
    expect(draft?.teamName).toHaveLength(TEAM_NAME_MAX);
    expect(draft?.memberIds).toEqual([ADA, LIN]);
  });
});

describe("usableDraft", () => {
  const draft = {
    teamName: "Owls v2",
    memberIds: [ADA],
    imagePaths: [GLOBAL, NOTE, null],
    slidesUrl: DECK,
    mindmapUrl: null,
    savedAt: SUBMITTED_MS + 1,
  };

  it("keeps a draft saved after the current version", () => {
    expect(usableDraft(draft, ENTRY)).toBe(draft);
  });

  it("drops a draft older than the current version", () => {
    expect(usableDraft({ ...draft, savedAt: SUBMITTED_MS - 1 }, ENTRY)).toBeNull();
  });

  it("drops a draft that says the same as the entry", () => {
    expect(usableDraft({ ...baseFields(ENTRY), savedAt: SUBMITTED_MS + 1 }, ENTRY)).toBeNull();
  });

  it("keeps any changed draft when nothing was submitted yet", () => {
    expect(usableDraft({ ...draft, savedAt: 1 }, null)).not.toBeNull();
  });
});

describe("saveDraft, readDraft and clearDraft", () => {
  const changed = { teamName: "Owls v2", memberIds: [ADA], imagePaths: [GLOBAL, NOTE, null], slidesUrl: DECK, mindmapUrl: null };

  it("round-trips a changed draft", () => {
    const storage = memoryStorage();
    saveDraft(storage, IDS, changed, ENTRY, 42);
    expect(readDraft(storage, IDS)).toEqual({ ...changed, savedAt: 42 });
  });

  it("removes the draft once the fields match the entry again", () => {
    const storage = memoryStorage();
    saveDraft(storage, IDS, changed, ENTRY, 42);
    saveDraft(storage, IDS, baseFields(ENTRY), ENTRY, 43);
    expect(storage.length).toBe(0);
  });

  it("keeps projects apart", () => {
    const storage = memoryStorage();
    saveDraft(storage, IDS, changed, ENTRY, 42);
    expect(readDraft(storage, { ...IDS, projectId: OTHER })).toBeNull();
  });

  it("clears a draft", () => {
    const storage = memoryStorage();
    saveDraft(storage, IDS, changed, ENTRY, 42);
    clearDraft(storage, IDS);
    expect(readDraft(storage, IDS)).toBeNull();
  });

  it("does nothing, and never throws, without a working storage", () => {
    const broken = memoryStorage({ broken: true });
    expect(() => saveDraft(broken, IDS, changed, ENTRY)).not.toThrow();
    expect(() => clearDraft(broken, IDS)).not.toThrow();
    expect(readDraft(broken, IDS)).toBeNull();
    expect(readDraft(null, IDS)).toBeNull();
    expect(() => saveDraft(null, IDS, changed, ENTRY)).not.toThrow();
  });
});

describe("the Mindmap link's status (QDIT-67)", () => {
  /** What the page hands the dialog: each stored link through prefillableMindmapUrl. */
  const start = (
    snapshot: { url: string | null; status: "live" | "dead" | "unknown" },
    version: { url: string | null; status: "live" | "dead" | "unknown" },
  ) =>
    startingMindmapUrl(prefillableMindmapUrl(snapshot.url, snapshot.status), {
      ...ENTRY!,
      mindmapUrl: prefillableMindmapUrl(version.url, version.status),
    });

  it("keeps a live or unknown link, drops a dead one", () => {
    expect(prefillableMindmapUrl(MAP_SENT, "live")).toBe(MAP_SENT);
    expect(prefillableMindmapUrl(MAP_SENT, "unknown")).toBe(MAP_SENT);
    expect(prefillableMindmapUrl(MAP_SENT, "dead")).toBeNull();
    expect(prefillableMindmapUrl(null, "live")).toBeNull();
  });

  it("skips a dead snapshot link for the version's live one", () => {
    expect(start({ url: MAP_SENT, status: "dead" }, { url: MAP_V1, status: "live" })).toBe(MAP_V1);
  });

  it("leaves the field empty when both are dead", () => {
    expect(start({ url: MAP_SENT, status: "dead" }, { url: MAP_V1, status: "dead" })).toBe("");
    expect(start({ url: null, status: "unknown" }, { url: MAP_V1, status: "dead" })).toBe("");
  });

  it("prefills as before when doqtri did not answer (unknown is live)", () => {
    expect(start({ url: MAP_SENT, status: "unknown" }, { url: MAP_V1, status: "unknown" })).toBe(MAP_SENT);
    expect(start({ url: null, status: "unknown" }, { url: MAP_V1, status: "unknown" })).toBe(MAP_V1);
  });

  it("still prefers a live snapshot link over the version's", () => {
    expect(start({ url: MAP_SENT, status: "live" }, { url: MAP_V1, status: "live" })).toBe(MAP_SENT);
  });
});

describe("the Mindmap link (QDIT-66)", () => {
  const stored = (value: unknown) => JSON.stringify(value);

  it("starts from the newest snapshot's link, then the version's, else empty", () => {
    expect(startingMindmapUrl(MAP_SENT, ENTRY)).toBe(MAP_SENT);
    expect(startingMindmapUrl(null, ENTRY)).toBe(MAP_V1);
    expect(startingMindmapUrl(null, { ...ENTRY!, mindmapUrl: null })).toBe("");
    expect(startingMindmapUrl(null, null)).toBe("");
    expect(startingMindmapUrl(MAP_SENT, null)).toBe(MAP_SENT);
  });

  it("is untouched (null) while it says what the field shows by itself, compared trimmed", () => {
    expect(typedMindmapUrl(MAP_SENT, MAP_SENT)).toBeNull();
    expect(typedMindmapUrl(` ${MAP_SENT} `, MAP_SENT)).toBeNull();
    expect(typedMindmapUrl("", "")).toBeNull();
  });

  it("is kept as typed once the team changes it, cleared included", () => {
    expect(typedMindmapUrl(MAP_V1, MAP_SENT)).toBe(MAP_V1);
    expect(typedMindmapUrl("https://www.doqtri.xyz/m/half", MAP_SENT)).toBe("https://www.doqtri.xyz/m/half");
    expect(typedMindmapUrl("", MAP_SENT)).toBe("");
  });

  it("an untouched field is never a change; a typed one always is", () => {
    expect(sameAsBase({ ...baseFields(ENTRY), mindmapUrl: null }, ENTRY)).toBe(true);
    expect(sameAsBase({ ...baseFields(ENTRY), mindmapUrl: MAP_V1 }, ENTRY)).toBe(false);
    expect(sameAsBase({ ...baseFields(ENTRY), mindmapUrl: "" }, ENTRY)).toBe(false);
  });

  it("a draft saved untouched follows a Send in doqtri made after it", () => {
    const storage = memoryStorage();
    // The team changed the team name; the Mindmap link was left as filled.
    saveDraft(storage, IDS, { ...baseFields(ENTRY), teamName: "Owls v2", mindmapUrl: null }, ENTRY, SUBMITTED_MS + 1);
    const draft = usableDraft(readDraft(storage, IDS), ENTRY);
    expect(draft?.mindmapUrl).toBeNull();
    // Opened again after a new Send: the field shows the new snapshot's link.
    expect(draft?.mindmapUrl ?? startingMindmapUrl(MAP_SENT, ENTRY)).toBe(MAP_SENT);
  });

  it("a typed link is kept by the draft over a newer snapshot's", () => {
    const storage = memoryStorage();
    const typed = typedMindmapUrl(MAP_V1, startingMindmapUrl(MAP_SENT, ENTRY));
    saveDraft(storage, IDS, { ...baseFields(ENTRY), mindmapUrl: typed }, ENTRY, SUBMITTED_MS + 1);
    const draft = usableDraft(readDraft(storage, IDS), ENTRY);
    expect(draft?.mindmapUrl ?? startingMindmapUrl(MAP_SENT, ENTRY)).toBe(MAP_V1);
  });

  it("an untouched link alone keeps no draft", () => {
    const storage = memoryStorage();
    saveDraft(storage, IDS, { ...baseFields(ENTRY), mindmapUrl: null }, ENTRY, SUBMITTED_MS + 1);
    expect(storage.length).toBe(0);
  });

  it("reads a draft from before the field as untouched, and caps a long one", () => {
    expect(parseDraft(stored({ teamName: "", memberIds: [], imagePaths: [], savedAt: 1 }), HACKATHON, PROJECT)?.mindmapUrl).toBeNull();
    expect(
      parseDraft(stored({ teamName: "", memberIds: [], imagePaths: [], mindmapUrl: null, savedAt: 1 }), HACKATHON, PROJECT)
        ?.mindmapUrl,
    ).toBeNull();
    expect(
      parseDraft(
        stored({ teamName: "", memberIds: [], imagePaths: [], mindmapUrl: "x".repeat(SLIDES_URL_MAX + 50), savedAt: 1 }),
        HACKATHON,
        PROJECT,
      )?.mindmapUrl,
    ).toHaveLength(SLIDES_URL_MAX + 1);
  });
});
