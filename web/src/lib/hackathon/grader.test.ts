import { describe, expect, it } from "vitest";

import {
  AI_RUN_SCHEMA,
  DEFAULT_GRADER_MODEL,
  gradeOnce,
  GRADER_MAX_RETRIES,
  GRADER_TIMEOUT_MS,
  GraderError,
  GraderRefusalError,
  GraderTruncatedError,
  graderModel,
  MODEL_FLAGS,
} from "@/lib/hackathon/grader";
import { buildGradingRequest } from "@/lib/hackathon/prompt";
import { InvalidAiRunError } from "@/lib/hackathon/rubric";
import { aiRun, doqtriSnapshot, ELIGIBLE, fakeClient, IMAGE, message, qditSnapshot, WINDOW } from "@/test/hackathon-fixtures";

const request = buildGradingRequest({
  teamName: "Team One",
  qdit: qditSnapshot(),
  doqtri: doqtriSnapshot(),
  window: WINDOW,
  eligibility: ELIGIBLE,
  images: [IMAGE],
});

describe("gradeOnce", () => {
  it("makes one structured-output call with no tools and returns the parsed run", async () => {
    const client = fakeClient(() => message(aiRun({ clarity: 9 }, ["placeholder"])));
    const result = await gradeOnce(client, request, { model: "claude-sonnet-5-5" });

    expect(client.calls).toHaveLength(1);
    const body = client.calls[0];
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.system).toBe(request.system);
    expect(body.messages).toBe(request.messages);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: AI_RUN_SCHEMA } });
    expect(client.options[0]).toMatchObject({ timeout: GRADER_TIMEOUT_MS, maxRetries: GRADER_MAX_RETRIES });
    expect(GRADER_TIMEOUT_MS).toBe(170_000);
    expect(GRADER_MAX_RETRIES).toBe(1);

    expect(result.run.criteria.clarity.score).toBe(9);
    expect(result.run.flags).toEqual(["placeholder"]);
    expect(result.model).toBe("claude-sonnet-5-5");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage).toEqual({
      input_tokens: 12_000,
      output_tokens: 2_500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2_600,
    });
  });

  it("joins text blocks and skips thinking blocks", async () => {
    const json = JSON.stringify(aiRun());
    const client = fakeClient(() =>
      message("", {
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: json.slice(0, 20), citations: null },
          { type: "text", text: json.slice(20), citations: null },
        ],
      } as never),
    );
    await expect(gradeOnce(client, request)).resolves.toMatchObject({ run: { summary: "SUMMARY-SECRET" } });
  });

  it("throws GraderRefusalError on a refusal", async () => {
    const client = fakeClient(() =>
      message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } } as never),
    );
    const error = await gradeOnce(client, request).catch((e) => e);
    expect(error).toBeInstanceOf(GraderRefusalError);
    expect(error.category).toBe("cyber");
  });

  it("throws GraderTruncatedError when the answer is cut off", async () => {
    for (const stop of ["max_tokens", "model_context_window_exceeded"] as const) {
      const client = fakeClient(() => message('{"criteria": {', { stop_reason: stop }));
      await expect(gradeOnce(client, request)).rejects.toBeInstanceOf(GraderTruncatedError);
    }
  });

  it("throws GraderError on any other stop", async () => {
    const client = fakeClient(() => message(aiRun(), { stop_reason: "pause_turn" }));
    await expect(gradeOnce(client, request)).rejects.toBeInstanceOf(GraderError);
  });

  it("throws InvalidAiRunError on malformed JSON", async () => {
    const client = fakeClient(() => message("not json {"));
    await expect(gradeOnce(client, request)).rejects.toBeInstanceOf(InvalidAiRunError);
  });

  it("throws InvalidAiRunError when a criterion is missing", async () => {
    const run = aiRun();
    delete (run.criteria as Partial<typeof run.criteria>).execution;
    const client = fakeClient(() => message(run));
    const error = await gradeOnce(client, request).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidAiRunError);
    expect(error.issues).toContain("criteria.execution is missing");
  });

  it("passes the abort signal through", async () => {
    const client = fakeClient();
    const controller = new AbortController();
    await gradeOnce(client, request, { signal: controller.signal });
    expect(client.options[0]?.signal).toBe(controller.signal);
  });
});

describe("the output schema", () => {
  it("requires every criterion with evidence before score, closed objects", () => {
    const criteria = (AI_RUN_SCHEMA.properties as Record<string, { required: string[]; properties: Record<string, unknown> }>).criteria;
    expect(criteria.required).toEqual(["clarity", "structure", "accuracy", "connections", "execution"]);
    expect(AI_RUN_SCHEMA.additionalProperties).toBe(false);
    const clarity = criteria.properties.clarity as { required: string[]; additionalProperties: boolean };
    expect(clarity.required).toEqual(["evidence", "score"]);
    expect(clarity.additionalProperties).toBe(false);
  });

  it("lets the model set only content flags", () => {
    expect(MODEL_FLAGS).toEqual([
      "manipulation",
      "placeholder",
      "off_topic",
      "images_unreadable",
      "images_contradict_notes",
    ]);
  });
});

describe("graderModel", () => {
  it("defaults to claude-sonnet-5-5 and honours HACKATHON_GRADER_MODEL", () => {
    expect(DEFAULT_GRADER_MODEL).toBe("claude-sonnet-5-5");
    expect(graderModel({})).toBe("claude-sonnet-5-5");
    expect(graderModel({ HACKATHON_GRADER_MODEL: "  " })).toBe("claude-sonnet-5-5");
    expect(graderModel({ HACKATHON_GRADER_MODEL: "claude-opus-5-5" })).toBe("claude-opus-5-5");
  });
});
