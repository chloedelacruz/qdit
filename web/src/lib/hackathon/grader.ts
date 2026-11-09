import Anthropic from "@anthropic-ai/sdk";

import { createFakeGraderClient, fakeGraderEnabled } from "@/lib/hackathon/fake-grader";
import type { GradingRequest } from "@/lib/hackathon/prompt";
import { parseAiRun, InvalidAiRunError } from "@/lib/hackathon/rubric";
import { AI_FLAGS, CRITERION_KEYS, type AiRunOutput } from "@/lib/hackathon/types";

/**
 * One AI review run: a single Messages API call (WP-4.7, D-119).
 *
 * No tools. The answer is constrained by structured outputs
 * (`output_config.format`, a JSON schema matching AiRunOutput) and then
 * validated again by `parseAiRun`, so nothing the model writes becomes a
 * score without passing both. This module logs nothing: the worker logs
 * version, run, status and timing, never content or scores.
 */

export const DEFAULT_GRADER_MODEL = "claude-sonnet-5-5";
/** Per HTTP attempt. The worker also aborts the call before the job's lease ends. */
export const GRADER_TIMEOUT_MS = 170_000;
/**
 * SDK retries on 408/409/429/5xx and connection errors. One, because the
 * queue retries too (with backoff and the provider's retry-after) and about
 * 60 teams must be graded within minutes of closing.
 */
export const GRADER_MAX_RETRIES = 1;
/** Medium: the review is short, and latency matters for 60 teams in under 3 minutes. */
export const GRADER_EFFORT = "medium" as const;
/** Room for adaptive thinking plus the JSON answer, within a non-streaming call. */
export const GRADER_MAX_TOKENS = 16_000;

/** `HACKATHON_GRADER_MODEL`, else claude-sonnet-5-5. */
export function graderModel(env: Record<string, string | undefined> = process.env): string {
  const value = env.HACKATHON_GRADER_MODEL?.trim();
  return value ? value : DEFAULT_GRADER_MODEL;
}

/** The Anthropic client the worker uses in production. */
export function createGraderClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, timeout: GRADER_TIMEOUT_MS, maxRetries: GRADER_MAX_RETRIES });
}

/**
 * The client the worker and the cron route grade with: the local fake for
 * `HACKATHON_GRADER_FAKE=1` outside a production build (fake-grader.ts),
 * else Claude with `ANTHROPIC_API_KEY`; null when neither is set.
 */
export function graderClientFromEnv(env: Record<string, string | undefined> = process.env): GraderClient | null {
  if (fakeGraderEnabled(env)) return createFakeGraderClient();
  return env.ANTHROPIC_API_KEY ? createGraderClient(env.ANTHROPIC_API_KEY) : null;
}

/** The part of the SDK client the grader calls; tests pass a fake. */
export interface GraderClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal; timeout?: number; maxRetries?: number },
    ): PromiseLike<Anthropic.Message>;
  };
}

/** Flags the model may set. `truncated_input` and `disagreement` are set by code. */
export const MODEL_FLAGS = AI_FLAGS.filter((f) => f !== "truncated_input" && f !== "disagreement");

/** The structured-output schema: AiRunOutput, with evidence written before each score. */
export const AI_RUN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["criteria", "summary", "flags"],
  properties: {
    criteria: {
      type: "object",
      additionalProperties: false,
      required: [...CRITERION_KEYS],
      properties: Object.fromEntries(
        CRITERION_KEYS.map((key) => [
          key,
          {
            type: "object",
            additionalProperties: false,
            required: ["evidence", "score"],
            properties: {
              evidence: { type: "string", description: "Specific justification, before the score." },
              score: { type: "integer", description: "0 to 10, per the rubric anchors." },
            },
          },
        ]),
      ),
    },
    summary: { type: "string", description: "Two to four sentences for the organisers." },
    flags: { type: "array", items: { type: "string", enum: MODEL_FLAGS } },
  },
};

/** The model stopped without a usable answer. */
export class GraderError extends Error {
  readonly stopReason: string | null;

  constructor(message: string, stopReason: string | null) {
    super(message);
    this.name = "GraderError";
    this.stopReason = stopReason;
  }
}

/** `stop_reason: "refusal"`: a safety classifier declined the request. */
export class GraderRefusalError extends GraderError {
  readonly category: string | null;

  constructor(category: string | null) {
    super(`The model declined to review this entry (refusal${category ? `, ${category}` : ""}).`, "refusal");
    this.name = "GraderRefusalError";
    this.category = category;
  }
}

/** The answer was cut off (`max_tokens` or the context window). */
export class GraderTruncatedError extends GraderError {
  constructor(stopReason: string) {
    super(`The model's answer was cut off (${stopReason}).`, stopReason);
    this.name = "GraderTruncatedError";
  }
}

export interface GradeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface GradeResult {
  run: AiRunOutput;
  model: string;
  usage: GradeUsage;
  stop_reason: string;
}

export interface GradeOptions {
  model?: string;
  /** Aborts the call (the worker ties it to the lease and the run budget). */
  signal?: AbortSignal;
}

/**
 * One review run. Throws `GraderRefusalError`, `GraderTruncatedError` or
 * `GraderError` for an unusable stop, `InvalidAiRunError` for output that is
 * not valid JSON or does not match the run schema, and the SDK's own errors
 * for HTTP failures after its retries.
 */
export async function gradeOnce(
  client: GraderClient,
  request: GradingRequest,
  options: GradeOptions = {},
): Promise<GradeResult> {
  const response = await client.messages.create(
    {
      model: options.model ?? graderModel(),
      max_tokens: GRADER_MAX_TOKENS,
      system: request.system,
      messages: request.messages,
      thinking: { type: "adaptive" },
      output_config: { effort: GRADER_EFFORT, format: { type: "json_schema", schema: AI_RUN_SCHEMA } },
    },
    { signal: options.signal, timeout: GRADER_TIMEOUT_MS, maxRetries: GRADER_MAX_RETRIES },
  );

  const stop = response.stop_reason;
  if (stop === "refusal") throw new GraderRefusalError(response.stop_details?.category ?? null);
  if (stop === "max_tokens" || stop === "model_context_window_exceeded") {
    throw new GraderTruncatedError(stop);
  }
  if (stop !== "end_turn") throw new GraderError(`Unexpected stop reason: ${stop ?? "none"}.`, stop);

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new InvalidAiRunError(["output is not valid JSON"]);
  }

  const u = response.usage;
  return {
    run: parseAiRun(raw),
    model: response.model,
    usage: {
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    },
    stop_reason: stop,
  };
}
