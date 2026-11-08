import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const PREFIX = "ht-github-app:v1:";
export type GithubAppCredentialField = "clientSecret" | "privateKey" | "webhookSecret" | "stateSecret";

function key(): Buffer {
  const secret = process.env.BYOK_CIPHER_SECRET;
  if (!secret || secret.length < 16) throw new Error("credential_key_unavailable");
  return Buffer.from(hkdfSync(
    "sha256", Buffer.from(secret, "utf8"),
    "hypertask-github-app-credential-v1", "hypertask-github-app-credential-v1", 32,
  ));
}

export function preflightGithubAppCredentialKey(): void {
  key();
}

export function encryptGithubAppCredential(field: GithubAppCredentialField, raw: string): string {
  try {
    if (!raw) throw new Error();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    cipher.setAAD(Buffer.from(`GithubAppCredential:${field}`, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
  } catch {
    throw new Error("credential_encode_failed");
  }
}

export function decryptGithubAppCredential(field: GithubAppCredentialField, raw: string): string {
  try {
    if (!raw.startsWith(PREFIX)) throw new Error();
    const payload = raw.slice(PREFIX.length);
    const bytes = Buffer.from(payload, "base64");
    if (bytes.length < 29 || bytes.toString("base64") !== payload) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`GithubAppCredential:${field}`, "utf8"));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("credential_decode_failed");
  }
}
