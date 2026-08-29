import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_REQUEST_AGE_SECONDS = 5 * 60;

export function verifySlackSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  timestampHeader: string | null | undefined,
  signingSecret: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!signingSecret || !signatureHeader?.startsWith("v0=") || !timestampHeader) {
    return false;
  }

  const timestamp = Number(timestampHeader);
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(Math.floor(nowMs / 1000) - timestamp) > MAX_REQUEST_AGE_SECONDS
  ) {
    return false;
  }

  const expected =
    "v0=" +
    createHmac("sha256", signingSecret)
      .update(`v0:${timestampHeader}:${rawBody}`, "utf8")
      .digest("hex");

  if (Buffer.byteLength(signatureHeader) !== Buffer.byteLength(expected)) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(signatureHeader, "utf8"),
    Buffer.from(expected, "utf8"),
  );
}
