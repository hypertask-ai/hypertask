import crypto from "crypto";


const SEPARATOR = ".";

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error("SESSION_SECRET or JWT_SECRET is required to sign unsubscribe links");
  return value;
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

export function createUnsubscribeToken(userId: number, email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, email: email.trim().toLowerCase() })
  ).toString("base64url");
  return `${payload}${SEPARATOR}${sign(payload)}`;
}

export function verifyUnsubscribeToken(
  token: string | null | undefined
): { userId: number; email: string } | null {
  if (!token) return null;

  const parts = token.split(SEPARATOR);
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const userId = Number(decoded?.uid);
    const email = typeof decoded?.email === "string" ? decoded.email : null;
    if (!Number.isInteger(userId) || userId <= 0 || !email) return null;
    return { userId, email };
  } catch {
    return null;
  }
}

export function unsubscribeUrl(userId: number, email: string): string {
  const base = process.env.NEXT_PUBLIC_BASEURL ?? "https://app.hypertask.ai";
  return `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(
    createUnsubscribeToken(userId, email)
  )}`;
}

export function unsubscribeHeaders(
  userId: number | null | undefined,
  email: string | null | undefined
): Record<string, string> | undefined {
  if (typeof userId !== "number" || !email) return undefined;
  const url = unsubscribeUrl(userId, email);
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
