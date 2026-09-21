import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

if (typeof window === "undefined" && !process.env.BYOK_CIPHER_SECRET) {
  console.error(
    "[SecretCipher] BYOK_CIPHER_SECRET is not set. " +
    "Secret encryption and decryption will fail at runtime. " +
    "Generate one with: openssl rand -hex 32"
  );
}

/**
 * AES-256-GCM blob for server-side secrets. Workers can decrypt with the same
 * BYOK_CIPHER_SECRET using this layout:
 *
 *   v1 binary (before base64): [1 byte version=0x01][12 byte iv][16 byte tag][ciphertext...]
 *  generated with:
 *  openssl rand -hex 32
 * Python (cryptography): derive key = SHA256(secret.encode()).digest();
 *   decrypt with AESGCM(iv).decrypt(nonce, ciphertext+tag, None) per library API
 *   (nonce=iv, tag appended to ciphertext as stored above).
 */

const VERSION = 0x01;
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/** Concatenate Uint8Arrays without Buffer typing issues (TS + @types/node). */
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Copy any ArrayBufferView into a plain Uint8Array (stable ArrayBuffer typing). */
function asU8(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function getKey(): Uint8Array {
  const secret = process.env.BYOK_CIPHER_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("BYOK_CIPHER_SECRET must be set (min 16 characters)");
  }
  return asU8(createHash("sha256").update(secret, "utf8").digest());
}

export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = asU8(randomBytes(IV_LEN));
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const enc = concatBytes(
    asU8(cipher.update(plain, "utf8")),
    asU8(cipher.final())
  );
  const tag = asU8(cipher.getAuthTag());
  const out = concatBytes(
    new Uint8Array([VERSION]),
    iv,
    tag,
    enc
  );
  return Buffer.from(out).toString("base64");
}

const HEADER_LEN = 1 + IV_LEN + TAG_LEN;

/**
 * Decrypt a blob produced by {@link encryptSecret}. Requires the same
 * `BYOK_CIPHER_SECRET` as encryption. Throws if the payload is malformed or
 * authentication fails (wrong secret or tampered ciphertext).
 */
export function decryptSecret(ciphertextBase64: string): string {
  const trimmed = ciphertextBase64.trim();
  if (!trimmed) {
    throw new Error("Ciphertext is empty");
  }

  const raw = Buffer.from(trimmed, "base64");

  if (raw.length < HEADER_LEN + 1) {
    throw new Error("Ciphertext is too short");
  }

  const buf = asU8(raw);
  if (buf[0] !== VERSION) {
    throw new Error(`Unsupported ciphertext version: ${buf[0]}`);
  }

  const iv = buf.subarray(1, 1 + IV_LEN);
  const tag = buf.subarray(1 + IV_LEN, HEADER_LEN);
  const enc = buf.subarray(HEADER_LEN);

  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  const plain = concatBytes(
    asU8(decipher.update(enc)),
    asU8(decipher.final())
  );
  return Buffer.from(plain).toString("utf8");
}

// Backward-compatible names for the existing BYOK call sites.
export const encryptByokSecret = encryptSecret;
export const decryptByokSecret = decryptSecret;
