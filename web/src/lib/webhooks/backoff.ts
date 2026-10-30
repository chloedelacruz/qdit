/**
 * When a failed webhook attempt is tried again (docs/integration/CONTRACT.md
 * section 9): up to 8 attempts — at once, then after 1 min, 5 min, 15 min,
 * 1 h, 3 h, 6 h and 12 h — each delay with +/-10% jitter. After the 8th
 * failure the event is dead. The database enforces the same cap
 * (`record_integration_delivery`), so a change here cannot keep an event
 * alive past it.
 */

export const MAX_ATTEMPTS = 8;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Delay before attempt n + 1, indexed by n - 1 (n = attempts made so far). */
export const RETRY_DELAYS_MS: readonly number[] = [
  1 * MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  1 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
];

export const JITTER = 0.1;

/**
 * Delay after the `attemptsMade`-th attempt failed, or null when that was the
 * last one. `random` returns [0, 1), like Math.random; the jitter spreads
 * retries so a receiver that was down does not get every event back in the
 * same second.
 */
export function retryDelayMs(attemptsMade: number, random: () => number = Math.random): number | null {
  if (!Number.isInteger(attemptsMade) || attemptsMade < 1) {
    throw new Error(`webhooks: attempts must be a positive integer, got ${attemptsMade}`);
  }
  if (attemptsMade >= MAX_ATTEMPTS) return null;

  const base = RETRY_DELAYS_MS[attemptsMade - 1];
  const factor = 1 - JITTER + 2 * JITTER * random();
  return Math.round(base * factor);
}

/** The next attempt's time, or null for dead. */
export function nextAttemptAt(
  attemptsMade: number,
  now: Date,
  random: () => number = Math.random,
): Date | null {
  const delay = retryDelayMs(attemptsMade, random);
  return delay === null ? null : new Date(now.getTime() + delay);
}
