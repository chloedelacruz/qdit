import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts and decrypts webhook signing secrets for `integration_webhooks`.
 *
 * AES-256-GCM with the key in INTEGRATION_WEBHOOK_ENCRYPTION_KEY (32 bytes,
 * base64), so the database holds ciphertext only and reading a secret takes
 * both the database and the server env. Why this and not Vault or an env-var
 * pointer is in supabase/migrations/20261024130000_integration_webhooks.sql.
 *
 * Format: `v1.<iv>.<ciphertext + 16-byte tag>`, both base64url, a 12-byte IV
 * per encryption. The row's `client_id` is the additional authenticated data,
 * so a ciphertext moved onto another client's row fails to decrypt.
 *
 * web/scripts/integration-webhook-secret.mjs writes the same format; its test
 * in `secret-box.test.ts` decrypts what the script prints.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function aad(clientId: string): Buffer {
  return Buffer.from(`qdit:integration_webhooks:${clientId}`, "utf8");
}

/**
 * The key from its env value: base64 or base64url of exactly 32 bytes.
 * Throws with the variable's name, never its value.
 */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) {
    throw new Error("webhooks: INTEGRATION_WEBHOOK_ENCRYPTION_KEY is not set. See web/.env.example.");
  }
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    throw new Error("webhooks: INTEGRATION_WEBHOOK_ENCRYPTION_KEY is not base64.");
  }
  const key = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `webhooks: INTEGRATION_WEBHOOK_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

export function encryptWebhookSecret(secret: string, clientId: string, key: Buffer): string {
  if (secret.length === 0) throw new Error("webhooks: empty secret");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(clientId));
  const sealed = Buffer.concat([cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${VERSION}.${iv.toString("base64url")}.${sealed.toString("base64url")}`;
}

/** Throws on a wrong key, a wrong client id, or any tampering. */
export function decryptWebhookSecret(ciphertext: string, clientId: string, key: Buffer): string {
  const [version, ivText, sealedText, ...rest] = ciphertext.split(".");
  if (version !== VERSION || !ivText || !sealedText || rest.length > 0) {
    throw new Error("webhooks: unrecognised secret ciphertext");
  }
  const iv = Buffer.from(ivText, "base64url");
  const sealed = Buffer.from(sealedText, "base64url");
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) {
    throw new Error("webhooks: malformed secret ciphertext");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad(clientId));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
