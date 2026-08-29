import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const LINK_STATE_TTL_MS = 10 * 60 * 1000;
const LINK_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export type SlackLinkState = {
  expiresAt: number;
  installId: string;
  issuedAt: number;
  nonce: string;
  slackUserId: string;
  version: 1;
};

export type SlackLinkConfirmation = {
  expiresAt: number;
  installId: string;
  issuedAt: number;
  nonce: string;
  slackUserId: string;
  userId: number;
  version: 2;
};

function stateSignature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

export function createSlackLinkState(
  input: { installId: string; slackUserId: string },
  secret: string,
  nowMs = Date.now(),
  nonce = randomBytes(18).toString("base64url"),
): string {
  const payload: SlackLinkState = {
    expiresAt: nowMs + LINK_STATE_TTL_MS,
    installId: input.installId,
    issuedAt: nowMs,
    nonce,
    slackUserId: input.slackUserId,
    version: 1,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encodedPayload}.${stateSignature(encodedPayload, secret)}`;
}

export function createSlackLinkConfirmation(
  input: { installId: string; slackUserId: string; userId: number },
  secret: string,
  nowMs = Date.now(),
  nonce = randomBytes(18).toString("base64url"),
): string {
  const payload: SlackLinkConfirmation = {
    expiresAt: nowMs + LINK_CONFIRMATION_TTL_MS,
    installId: input.installId,
    issuedAt: nowMs,
    nonce,
    slackUserId: input.slackUserId,
    userId: input.userId,
    version: 2,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encodedPayload}.${stateSignature(encodedPayload, secret)}`;
}

export function verifySlackLinkState(
  state: string | null | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): SlackLinkState | null {
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
    ) as Partial<SlackLinkState>;
    if (
      payload.version !== 1 ||
      typeof payload.installId !== "string" ||
      !payload.installId ||
      typeof payload.slackUserId !== "string" ||
      !payload.slackUserId ||
      typeof payload.nonce !== "string" ||
      !payload.nonce ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.issuedAt > nowMs + 30_000 ||
      payload.expiresAt <= nowMs ||
      payload.expiresAt - payload.issuedAt !== LINK_STATE_TTL_MS
    ) {
      return null;
    }
    return payload as SlackLinkState;
  } catch {
    return null;
  }
}

export function verifySlackLinkConfirmation(
  confirmation: string | null | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): SlackLinkConfirmation | null {
  if (!confirmation || !secret) return null;
  const [encodedPayload, suppliedSignature, extra] = confirmation.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return null;

  const expectedSignature = stateSignature(encodedPayload, secret);
  if (
    Buffer.byteLength(suppliedSignature) !==
      Buffer.byteLength(expectedSignature) ||
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
    ) as Partial<SlackLinkConfirmation>;
    if (
      payload.version !== 2 ||
      typeof payload.installId !== "string" ||
      !payload.installId ||
      typeof payload.slackUserId !== "string" ||
      !payload.slackUserId ||
      typeof payload.userId !== "number" ||
      !Number.isSafeInteger(payload.userId) ||
      payload.userId <= 0 ||
      typeof payload.nonce !== "string" ||
      !payload.nonce ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.issuedAt > nowMs + 30_000 ||
      payload.expiresAt <= nowMs ||
      payload.expiresAt - payload.issuedAt !== LINK_CONFIRMATION_TTL_MS
    ) {
      return null;
    }
    return payload as SlackLinkConfirmation;
  } catch {
    return null;
  }
}

export async function consumeSlackLinkState(
  state: string | null | undefined,
  secret: string | undefined,
  claimOnce: (receiptId: string) => Promise<boolean>,
  nowMs = Date.now(),
): Promise<SlackLinkState | null> {
  const verified = verifySlackLinkState(state, secret, nowMs);
  if (!verified) return null;
  return (await claimOnce(`slack-link:${verified.nonce}`)) ? verified : null;
}

export async function consumeSlackLinkConfirmation(
  confirmation: string | null | undefined,
  secret: string | undefined,
  claimOnce: (receiptId: string) => Promise<boolean>,
  nowMs = Date.now(),
): Promise<SlackLinkConfirmation | null> {
  const verified = verifySlackLinkConfirmation(confirmation, secret, nowMs);
  if (!verified) return null;
  return (await claimOnce(`slack-link-confirm:${verified.nonce}`))
    ? verified
    : null;
}
