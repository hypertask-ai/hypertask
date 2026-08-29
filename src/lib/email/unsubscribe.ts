import crypto from "crypto";

// HTPR-4164: Gmail and Yahoo's 2024 bulk-sender rules want a one-click
// List-Unsubscribe once volume passes ~5k/day, and notification volume gets
// there. Missing it costs inbox placement for every email we send.
//
// It is also the only stop path that works for someone who cannot log in. Invite
// mail goes to people with no account, and the footer's "Notification settings"
// link is useless to them.
//
// Deliberately its own HMAC rather than the app JWT: this token is handed to
// mail providers, who fetch the URL unattended to validate one-click. It must
// grant exactly one power — silence this address — and nothing else, so it can
// never be confused for a session.

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

/** Token proving the holder was mailed at this address. No expiry: an unsubscribe
 *  link has to keep working in a mailbox someone opens months later. */
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
  // Constant-time: a length mismatch would throw in timingSafeEqual.
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

/**
 * Headers that make a mail client show its own native Unsubscribe button.
 * List-Unsubscribe-Post is what makes it ONE-click: the provider POSTs the URL
 * itself instead of sending the human to a landing page.
 */
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
