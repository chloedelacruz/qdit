#!/usr/bin/env node
/**
 * Registers or rotates a webhook signing secret for `integration_webhooks`
 * (supabase/migrations/20261024130000_integration_webhooks.sql).
 *
 * It prints, and does nothing else — no network, no database:
 *   1. the plain secret, to set as QDIT_WEBHOOK_SECRET in doqtri;
 *   2. the SQL to run in qdit's Supabase SQL editor, carrying only the
 *      ciphertext.
 *
 * The encryption is the same as web/src/lib/webhooks/secret-box.ts
 * (AES-256-GCM, `v1.<iv>.<ciphertext+tag>`, client id as additional data);
 * secret-box.test.ts runs this script and decrypts what it prints.
 *
 * Usage (from web/):
 *
 *   node scripts/integration-webhook-secret.mjs --generate-key
 *       a new INTEGRATION_WEBHOOK_ENCRYPTION_KEY
 *
 *   INTEGRATION_WEBHOOK_ENCRYPTION_KEY=... node scripts/integration-webhook-secret.mjs \
 *     --client-id <oauth client id> --url https://www.doqtri.xyz/api/integrations/qdit/webhook
 *       a new secret and the INSERT for a new webhook row
 *
 *   ... --client-id <id> --rotate
 *       a new secret and the UPDATE that sets it as next_secret_ciphertext;
 *       once doqtri uses it, promote it (the printed comment says how)
 *
 * A secret of your own can be passed in WEBHOOK_SECRET (env, so it does not
 * land in shell history or the process list); otherwise one is generated.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "generate-key": { type: "boolean", default: false },
    "client-id": { type: "string" },
    url: { type: "string" },
    rotate: { type: "boolean", default: false },
  },
});

function fail(message) {
  console.error(`integration-webhook-secret: ${message}`);
  process.exit(1);
}

if (values["generate-key"]) {
  console.log(randomBytes(32).toString("base64"));
  process.exit(0);
}

const rawKey = process.env.INTEGRATION_WEBHOOK_ENCRYPTION_KEY?.trim();
if (!rawKey) fail("INTEGRATION_WEBHOOK_ENCRYPTION_KEY is not set (try --generate-key).");
const key = Buffer.from(rawKey.replace(/-/g, "+").replace(/_/g, "/"), "base64");
if (key.length !== 32) fail("INTEGRATION_WEBHOOK_ENCRYPTION_KEY must decode to 32 bytes.");

const clientId = values["client-id"];
if (!clientId) fail("--client-id is required.");
if (!values.rotate && !values.url) fail("--url is required unless --rotate.");

const secret = process.env.WEBHOOK_SECRET || `whsec_${randomBytes(32).toString("base64url")}`;

const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
cipher.setAAD(Buffer.from(`qdit:integration_webhooks:${clientId}`, "utf8"));
const sealed = Buffer.concat([cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]);
const ciphertext = `v1.${iv.toString("base64url")}.${sealed.toString("base64url")}`;

const sql = (value) => `'${value.replace(/'/g, "''")}'`;

console.log(`# QDIT_WEBHOOK_SECRET for doqtri (shown once; store it in doqtri's env only):`);
console.log(secret);
console.log("");
console.log("-- Run in qdit's Supabase SQL editor:");
if (values.rotate) {
  console.log(
    `update public.integration_webhooks set next_secret_ciphertext = ${sql(ciphertext)} ` +
      `where client_id = ${sql(clientId)};`,
  );
  console.log("-- Deliveries now carry both signatures. Once doqtri runs on the new secret:");
  console.log(
    "-- update public.integration_webhooks set secret_ciphertext = next_secret_ciphertext, " +
      `next_secret_ciphertext = null where client_id = ${sql(clientId)};`,
  );
} else {
  console.log(
    "insert into public.integration_webhooks (client_id, target_url, secret_ciphertext) " +
      `values (${sql(clientId)}, ${sql(values.url)}, ${sql(ciphertext)});`,
  );
}
console.log(`-- ciphertext: ${ciphertext}`);
