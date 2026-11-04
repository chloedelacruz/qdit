/**
 * Configuration for the suite that runs qdit against a real doqtri (QDIT-1).
 *
 * Every value comes from the environment. The README next to this file
 * lists what each one is and where it comes from. Nothing here has a default
 * that points at a real deployment: an unset origin is an error, not a
 * fallback to production.
 *
 * Two guards keep the suite off production, and both fail closed:
 *
 * 1. Neither app's origin may be a production host. That list is public: the
 *    production sites are linked from both READMEs.
 * 2. Both Supabase projects must be named in DOQTRI_IT_ALLOWED_SUPABASE_REFS.
 *    No project ref is written in this file (doqtri's e2e guard follows the
 *    same rule), so a ref that is not listed there is refused, whichever
 *    project it is.
 *
 * The suite writes real rows in both apps: accounts, a qdit project, doqtri
 * notes, links, milestones, an OAuth grant. That is why it never runs by
 * accident (it is not in `npm test` or `npm run test:e2e`), and why these
 * guards exist.
 */

/** Production sites of the pair. The suite refuses to run against any of them. */
export const PRODUCTION_HOSTS = [
  "qdit.app",
  "www.qdit.app",
  "qdit.atalusan.com",
  "doqtri.xyz",
  "www.doqtri.xyz",
] as const;

type Spec = { name: string; description: string; secret?: boolean; optional?: boolean };

const SPECS = {
  qditOrigin: { name: "DOQTRI_IT_QDIT_ORIGIN", description: "qdit's origin, no trailing slash (http://localhost:3000 or a preview URL)" },
  doqtriOrigin: { name: "DOQTRI_IT_DOQTRI_ORIGIN", description: "doqtri's origin; must equal qdit's DOQTRI_ORIGIN" },

  qditSupabaseUrl: { name: "DOQTRI_IT_QDIT_SUPABASE_URL", description: "the Supabase project qdit runs on" },
  qditPublishableKey: { name: "DOQTRI_IT_QDIT_SUPABASE_PUBLISHABLE_KEY", description: "that project's publishable (anon) key" },
  qditSecretKey: { name: "DOQTRI_IT_QDIT_SUPABASE_SECRET_KEY", description: "that project's secret key, for setup, read-back and cleanup", secret: true },
  qditCronSecret: { name: "DOQTRI_IT_QDIT_CRON_SECRET", description: "qdit's CRON_SECRET, to run webhook delivery on demand", secret: true },

  doqtriSupabaseUrl: { name: "DOQTRI_IT_DOQTRI_SUPABASE_URL", description: "the Supabase project doqtri runs on" },
  doqtriAnonKey: { name: "DOQTRI_IT_DOQTRI_SUPABASE_ANON_KEY", description: "that project's publishable (anon) key" },
  doqtriServiceKey: { name: "DOQTRI_IT_DOQTRI_SUPABASE_SERVICE_ROLE_KEY", description: "that project's service role key, for seeding notes, read-back and cleanup", secret: true },

  clientId: { name: "DOQTRI_IT_DOQTRI_OAUTH_CLIENT_ID", description: "doqtri's OAuth client id on this qdit (a UUID; doqtri's QDIT_OAUTH_CLIENT_ID)" },
  clientSecret: { name: "DOQTRI_IT_DOQTRI_OAUTH_CLIENT_SECRET", description: "that client's secret (doqtri's QDIT_CLIENT_SECRET), for the suite's own token", secret: true },

  allowedRefs: { name: "DOQTRI_IT_ALLOWED_SUPABASE_REFS", description: "comma-separated Supabase refs this suite may write to; both projects above must be listed, production never" },

  seed: { name: "DOQTRI_IT_SEED", description: "salt for the test wallets, so two people running the suite get separate accounts", optional: true },
  walkedQditPage: { name: "DOQTRI_IT_WALKED_QDIT_PAGE", description: "path of a milestone's public page taken through release plan S6 step 1 by hand: /p/<slug>/<milestone id>", optional: true },
  walkedDocId: { name: "DOQTRI_IT_WALKED_DOC_ID", description: "the doqtri doc that milestone is linked to", optional: true },
} satisfies Record<string, Spec>;

export type Env = { [K in keyof typeof SPECS]: string };

function trimOrigin(value: string): string {
  return value.replace(/\/+$/, "");
}

function refOf(url: string): string {
  return new URL(url).hostname.split(".")[0];
}

/**
 * Reads and checks the whole configuration. Throws one error naming every
 * problem at once, so a first run says everything that is missing instead of
 * one variable per attempt. Never prints a value.
 */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const problems: string[] = [];
  const out = {} as Env;

  for (const [key, spec] of Object.entries(SPECS) as [keyof typeof SPECS, Spec][]) {
    const value = (source[spec.name] ?? "").trim();
    if (!value && !spec.optional) problems.push(`${spec.name} is not set: ${spec.description}`);
    out[key] = value;
  }
  if (problems.length > 0) throw new Error(`doqtri integration suite is not configured:\n- ${problems.join("\n- ")}`);

  out.qditOrigin = trimOrigin(out.qditOrigin);
  out.doqtriOrigin = trimOrigin(out.doqtriOrigin);
  out.seed ||= "doqtri-it";

  for (const [name, value] of [
    ["DOQTRI_IT_QDIT_ORIGIN", out.qditOrigin],
    ["DOQTRI_IT_DOQTRI_ORIGIN", out.doqtriOrigin],
    ["DOQTRI_IT_QDIT_SUPABASE_URL", out.qditSupabaseUrl],
    ["DOQTRI_IT_DOQTRI_SUPABASE_URL", out.doqtriSupabaseUrl],
  ] as const) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      problems.push(`${name} is not a URL`);
      continue;
    }
    if ((PRODUCTION_HOSTS as readonly string[]).includes(url.hostname)) {
      problems.push(`${name} points at production (${url.hostname}). This suite writes data; run it against a non-production pair only.`);
    }
  }
  if (problems.length > 0) throw new Error(`Refusing to run:\n- ${problems.join("\n- ")}`);

  const allowed = out.allowedRefs.split(",").map((ref) => ref.trim()).filter(Boolean);
  for (const [name, url] of [
    ["DOQTRI_IT_QDIT_SUPABASE_URL", out.qditSupabaseUrl],
    ["DOQTRI_IT_DOQTRI_SUPABASE_URL", out.doqtriSupabaseUrl],
  ] as const) {
    const ref = refOf(url);
    if (!allowed.includes(ref)) {
      problems.push(`${name}: Supabase project "${ref}" is not in DOQTRI_IT_ALLOWED_SUPABASE_REFS. List it there if, and only if, it is not production.`);
    }
  }
  if (problems.length > 0) throw new Error(`Refusing to run:\n- ${problems.join("\n- ")}`);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(out.clientId)) {
    throw new Error("DOQTRI_IT_DOQTRI_OAUTH_CLIENT_ID is not a UUID; qdit refuses such a client (D-77, D-96).");
  }
  if (Boolean(out.walkedQditPage) !== Boolean(out.walkedDocId)) {
    throw new Error("Set DOQTRI_IT_WALKED_QDIT_PAGE and DOQTRI_IT_WALKED_DOC_ID together, or neither.");
  }
  if (out.walkedQditPage && !/^\/p\/[a-z0-9-]+\/[0-9a-f-]{36}$/.test(out.walkedQditPage)) {
    throw new Error("DOQTRI_IT_WALKED_QDIT_PAGE must look like /p/<slug>/<milestone id>.");
  }
  return out;
}

/** qdit's OAuth issuer: Supabase Auth on qdit's project (contract section 5). */
export function issuerOf(env: Env): string {
  return `${env.qditSupabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

/** The redirect URI registered on doqtri's client (release plan S4.3). */
export function callbackOf(env: Env): string {
  return `${env.doqtriOrigin}/api/integrations/qdit/callback`;
}

/** Names of every variable, for the README check and .env.example. */
export const VARIABLE_NAMES = Object.values(SPECS).map((spec) => spec.name);

let cached: Env | null = null;
/** The configuration, read once per worker. */
export function env(): Env {
  cached ??= readEnv();
  return cached;
}
