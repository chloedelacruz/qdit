import { readEnv } from "./env";

/**
 * Fails the run before any test starts when the configuration is missing,
 * points at production, or either app is down. A run that cannot reach both
 * apps would otherwise report a page of unrelated failures.
 */
export default async function globalSetup(): Promise<void> {
  const env = readEnv();

  for (const [name, origin] of [
    ["qdit", env.qditOrigin],
    ["doqtri", env.doqtriOrigin],
  ] as const) {
    let status: number;
    try {
      status = (await fetch(origin, { redirect: "manual" })).status;
    } catch (error) {
      throw new Error(`${name} at ${origin} cannot be reached: ${error instanceof Error ? error.message : error}`);
    }
    if (status >= 500) throw new Error(`${name} at ${origin} answered ${status}.`);
  }

  // doqtri's integration flag: with it off every /api/integrations/qdit route
  // answers 404 and nothing below means anything.
  const flag = await fetch(`${env.doqtriOrigin}/api/integrations/qdit/connect`, { redirect: "manual" });
  if (flag.status === 404) {
    throw new Error("doqtri answers 404 on /api/integrations/qdit/connect: NEXT_PUBLIC_QDIT_INTEGRATION is off there.");
  }
}
