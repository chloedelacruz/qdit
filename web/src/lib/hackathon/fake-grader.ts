import Anthropic from "@anthropic-ai/sdk";

import type { GraderClient } from "@/lib/hackathon/grader";
import { CRITERION_KEYS } from "@/lib/hackathon/types";

/**
 * A stand-in for the Anthropic client, for local dry runs only (WP-4.7,
 * QDIT-49; docs/runbooks/hackathon.md, "Dry run").
 *
 * `HACKATHON_GRADER_FAKE=1` makes the grading worker and the cron route use
 * this instead of Claude, so a local stack can be loaded with 60 teams and
 * graded end to end without an API key and without spending anything. It is
 * honoured only when `NODE_ENV` is not `production`: `next build` and
 * `next start` (and every Vercel deployment) run as production, so it works
 * under `next dev` and in tests, and nowhere a real event could reach.
 *
 * The answer goes through the real path: `gradeOnce` parses it, the worker
 * clamps and records it with the service-role RPCs, and the queue settles
 * as it would for a model. Scores are derived from a hash of the request, so
 * the same submission scores the same and different teams spread out. The
 * stored model is `fake-grader`, so a fake run is never mistaken for a real
 * one.
 *
 * `HACKATHON_GRADER_FAKE_MS` sets the delay per call as `min-max` in
 * milliseconds (default `1000-3000`), to give the queue a realistic load.
 */

export const FAKE_GRADER_MODEL = "fake-grader";
const DEFAULT_DELAY_MS: readonly [number, number] = [1000, 3000];

/** True for `HACKATHON_GRADER_FAKE=1` outside a production build. */
export function fakeGraderEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.HACKATHON_GRADER_FAKE === "1" && env.NODE_ENV !== "production";
}

/** `min-max` (ms), or one number; the default for anything unreadable. */
export function fakeDelayRange(value: string | undefined): readonly [number, number] {
  const match = value?.trim().match(/^(\d{1,6})(?:-(\d{1,6}))?$/);
  if (!match) return DEFAULT_DELAY_MS;
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  return max >= min ? [min, max] : DEFAULT_DELAY_MS;
}

/** FNV-1a, 32-bit: stable across runs and machines, no crypto needed. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer scores 3–9 per criterion, from the request text. */
export function fakeScores(requestText: string): Record<(typeof CRITERION_KEYS)[number], number> {
  const base = hash(requestText);
  return Object.fromEntries(
    CRITERION_KEYS.map((key, i) => [key, 3 + (hash(`${base}:${i}:${key}`) % 7)]),
  ) as Record<(typeof CRITERION_KEYS)[number], number>;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Anthropic.APIUserAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Anthropic.APIUserAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The fake client. `random` and `delayMs` are for tests. */
export function createFakeGraderClient(
  options: { delayMs?: readonly [number, number]; random?: () => number } = {},
): GraderClient {
  const [min, max] = options.delayMs ?? fakeDelayRange(process.env.HACKATHON_GRADER_FAKE_MS);
  const random = options.random ?? Math.random;

  return {
    messages: {
      async create(body, callOptions) {
        await wait(min + Math.round(random() * (max - min)), callOptions?.signal);

        const scores = fakeScores(JSON.stringify(body.messages));
        const output = {
          criteria: Object.fromEntries(
            CRITERION_KEYS.map((key) => [key, { evidence: "Fake grader: no model was called.", score: scores[key] }]),
          ),
          summary: "Fake grader run for a local dry run. Not a review.",
          flags: [],
        };

        return {
          id: `msg_fake_${hash(JSON.stringify(body.messages)).toString(16)}`,
          type: "message",
          role: "assistant",
          model: FAKE_GRADER_MODEL,
          content: [{ type: "text", text: JSON.stringify(output), citations: null }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        } as unknown as Anthropic.Message;
      },
    },
  };
}
