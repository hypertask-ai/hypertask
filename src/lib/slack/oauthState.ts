import { createHmac, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

export type SlackOAuthState = {
  expiresAt: number;
  issuedAt: number;
  teamId: string;
  userId: number;
  version: 1;
};

function stateSignature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

export function createSlackOAuthState(
  input: { teamId: string; userId: number },
  secret: string,
  nowMs = Date.now(),
): string {
  const payload: SlackOAuthState = {
    expiresAt: nowMs + STATE_TTL_MS,
    issuedAt: nowMs,
    teamId: input.teamId,
    userId: input.userId,
    version: 1,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encodedPayload}.${stateSignature(encodedPayload, secret)}`;
}

export function verifySlackOAuthState(
  state: string | null | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): SlackOAuthState | null {
  if (!state || !secret) return null;
  const [encodedPayload, suppliedSignature, extra] = state.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return null;

  const expectedSignature = stateSignature(encodedPayload, secret);
  if (
    Buffer.byteLength(suppliedSignature) !==
    Buffer.byteLength(expectedSignature)
  ) {
    return null;
  }
  if (
    !timingSafeEqual(
      Buffer.from(suppliedSignature, "utf8"),
      Buffer.from(expectedSignature, "utf8"),
    )
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<SlackOAuthState>;
    if (
      payload.version !== 1 ||
      typeof payload.userId !== "number" ||
      !Number.isInteger(payload.userId) ||
      typeof payload.teamId !== "string" ||
      !payload.teamId.trim() ||
      typeof payload.issuedAt !== "number" ||
      !Number.isFinite(payload.issuedAt) ||
      typeof payload.expiresAt !== "number" ||
      !Number.isFinite(payload.expiresAt) ||
      payload.issuedAt > nowMs + 60_000 ||
      payload.expiresAt < nowMs
    ) {
      return null;
    }
    return payload as SlackOAuthState;
  } catch {
    return null;
  }
}
