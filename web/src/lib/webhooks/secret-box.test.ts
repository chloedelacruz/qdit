import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decryptWebhookSecret, encryptWebhookSecret, parseEncryptionKey } from "./secret-box";

const KEY = randomBytes(32);
const CLIENT = "9b8a7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";
const SECRET = "whsec_example_do_not_use";

/** The CHECK on integration_webhooks.secret_ciphertext. */
const COLUMN_SHAPE = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;

describe("secret box", () => {
  it("round-trips, in the shape the column accepts", () => {
    const sealed = encryptWebhookSecret(SECRET, CLIENT, KEY);
    expect(sealed).toMatch(COLUMN_SHAPE);
    expect(sealed).not.toContain(SECRET);
    expect(decryptWebhookSecret(sealed, CLIENT, KEY)).toBe(SECRET);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptWebhookSecret(SECRET, CLIENT, KEY)).not.toBe(encryptWebhookSecret(SECRET, CLIENT, KEY));
  });

  it("does not decrypt under another client id (ciphertext moved between rows)", () => {
    const sealed = encryptWebhookSecret(SECRET, CLIENT, KEY);
    expect(() => decryptWebhookSecret(sealed, "another-client", KEY)).toThrow();
  });

  it("does not decrypt under another key", () => {
    const sealed = encryptWebhookSecret(SECRET, CLIENT, KEY);
    expect(() => decryptWebhookSecret(sealed, CLIENT, randomBytes(32))).toThrow();
  });

  it("detects tampering", () => {
    const sealed = encryptWebhookSecret(SECRET, CLIENT, KEY);
    const [version, iv, body] = sealed.split(".");
    const bytes = Buffer.from(body, "base64url");
    bytes[0] ^= 0x01;
    expect(() => decryptWebhookSecret(`${version}.${iv}.${bytes.toString("base64url")}`, CLIENT, KEY)).toThrow();
    expect(() => decryptWebhookSecret("v2" + sealed.slice(2), CLIENT, KEY)).toThrow(/unrecognised/);
    expect(() => decryptWebhookSecret(SECRET, CLIENT, KEY)).toThrow(/unrecognised/);
  });
});

describe("parseEncryptionKey", () => {
  it("accepts base64 and base64url of 32 bytes", () => {
    expect(parseEncryptionKey(KEY.toString("base64")).equals(KEY)).toBe(true);
    expect(parseEncryptionKey(KEY.toString("base64url")).equals(KEY)).toBe(true);
    expect(parseEncryptionKey(` ${KEY.toString("base64")}\n`).equals(KEY)).toBe(true);
  });

  it("refuses a missing, malformed or wrong-length key, naming the variable only", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(/INTEGRATION_WEBHOOK_ENCRYPTION_KEY is not set/);
    expect(() => parseEncryptionKey("")).toThrow(/not set/);
    expect(() => parseEncryptionKey("not base64!")).toThrow(/not base64/);
    const short = randomBytes(16).toString("base64");
    expect(() => parseEncryptionKey(short)).toThrow(/32 bytes, got 16/);
    try {
      parseEncryptionKey(short);
    } catch (error) {
      expect(String(error)).not.toContain(short);
    }
  });
});

describe("scripts/integration-webhook-secret.mjs", () => {
  const script = fileURLToPath(new URL("../../../scripts/integration-webhook-secret.mjs", import.meta.url));

  function run(args: string[], env: Record<string, string>) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
    });
    return result;
  }

  it("prints a secret and an INSERT whose ciphertext this module decrypts", () => {
    const result = run(["--client-id", CLIENT, "--url", "https://www.doqtri.xyz/api/integrations/qdit/webhook"], {
      INTEGRATION_WEBHOOK_ENCRYPTION_KEY: KEY.toString("base64"),
    });
    expect(result.status).toBe(0);

    const lines = result.stdout.split("\n");
    const secret = lines[1];
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

    const insert = lines.find((line) => line.startsWith("insert into public.integration_webhooks"));
    const ciphertext = /'(v1\.[^']+)'/.exec(insert ?? "")?.[1];
    expect(ciphertext).toMatch(COLUMN_SHAPE);
    expect(decryptWebhookSecret(ciphertext!, CLIENT, KEY)).toBe(secret);
  });

  it("encrypts a given WEBHOOK_SECRET for rotation into next_secret_ciphertext", () => {
    const result = run(["--client-id", CLIENT, "--rotate"], {
      INTEGRATION_WEBHOOK_ENCRYPTION_KEY: KEY.toString("base64"),
      WEBHOOK_SECRET: SECRET,
    });
    expect(result.status).toBe(0);
    const update = result.stdout.split("\n").find((line) => line.startsWith("update public.integration_webhooks"));
    expect(update).toContain("next_secret_ciphertext");
    const ciphertext = /'(v1\.[^']+)'/.exec(update ?? "")?.[1];
    expect(decryptWebhookSecret(ciphertext!, CLIENT, KEY)).toBe(SECRET);
  });

  it("refuses to run without the key", () => {
    const result = run(["--client-id", CLIENT, "--url", "https://x.test/hook"], {});
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });
});
