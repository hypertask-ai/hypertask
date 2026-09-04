import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived signed grant naming exactly the object keys one presign request
 * minted, and for whom (HTPR-5524 review).
 *
 * Without it, `/api/tasks/uploadFinalize` would authorize on the key prefix
 * alone, so any signed-in user who learned another user's attachment key could
 * ask for it to be deleted. The grant makes finalization a capability handed
 * back to the same caller, not a bucket-wide permission.
 */

export type UploadGrant = {
  userId: number;
  keys: string[];
};

type SignedGrant = UploadGrant & { exp: number };

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!value) {
    throw new Error("Missing SESSION_SECRET or JWT_SECRET env var");
  }
  return value;
}

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signUploadGrant(grant: UploadGrant, ttlSeconds: number): string {
  const payload: SignedGrant = {
    ...grant,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifyUploadGrant(token: unknown): UploadGrant | null {
  if (typeof token !== "string") return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = Buffer.from(sign(encoded));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString()
    ) as SignedGrant;
    if (
      typeof payload?.userId !== "number" ||
      !Array.isArray(payload.keys) ||
      payload.keys.some((key) => typeof key !== "string") ||
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return { userId: payload.userId, keys: payload.keys };
  } catch {
    return null;
  }
}
