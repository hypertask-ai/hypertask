import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

import {
  GOOGLE_CALENDAR_JWKS_URL,
  GOOGLE_CALENDAR_SETTINGS_PATH,
  GOOGLE_CALENDAR_TOKEN_URL,
} from "./paths";

export const GOOGLE_CALENDAR_OAUTH_ATTEMPT_COOKIE = "ht_google_calendar_oauth";
export const GOOGLE_CALENDAR_OAUTH_ATTEMPT_MAX_AGE_SECONDS = 10 * 60;
const ATTEMPT_TTL_MS = GOOGLE_CALENDAR_OAUTH_ATTEMPT_MAX_AGE_SECONDS * 1000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_TOKEN_LENGTH = 8192;
const MAX_EXPIRES_IN_SECONDS = 400 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 7000;

export type GoogleCalendarOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

export type GoogleCalendarToken = {
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string;
};

export type GoogleIdentity = {
  email: string | null;
  subject: string;
};

type OAuthAttempt = {
  codeVerifier: string;
  expiresAt: number;
  issuedAt: number;
  nonce: string;
  returnTo: string;
  state: string;
  userId: number;
  version: 1;
};

export class GoogleOAuthRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly oauthError: string | null,
  ) {
    super(`Google OAuth request failed (${status})`);
  }
}

export function getGoogleCalendarOAuthConfig(): GoogleCalendarOAuthConfig | null {
  const clientId = process.env.GOOGLE_ID?.trim();
  const clientSecret = process.env.GOOGLE_SECRET?.trim();
  if (clientId && clientSecret) return { clientId, clientSecret };
  const missing = [
    clientId ? null : "GOOGLE_ID",
    clientSecret ? null : "GOOGLE_SECRET",
  ].filter(Boolean);
  console.error(
    "Google Calendar OAuth is not configured",
    `missing ${missing.join(" and ")}`,
  );
  return null;
}

export function safeGoogleCalendarReturnTo(
  value: string | null | undefined,
): string {
  if (
    !value ||
    value.length > 2000 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return GOOGLE_CALENDAR_SETTINGS_PATH;
  }
  try {
    const base = new URL("https://app.invalid");
    const target = new URL(value, base);
    const pathname = decodeURIComponent(target.pathname);
    if (
      target.origin !== base.origin ||
      pathname.includes("\\") ||
      pathname.includes("\0") ||
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/_next" ||
      pathname.startsWith("/_next/")
    ) {
      return GOOGLE_CALENDAR_SETTINGS_PATH;
    }
    const normalized = `${target.pathname}${target.search}${target.hash}`;
    return Buffer.byteLength(normalized, "utf8") <= 2000
      ? normalized
      : GOOGLE_CALENDAR_SETTINGS_PATH;
  } catch {
    return GOOGLE_CALENDAR_SETTINGS_PATH;
  }
}

const sign = (value: string, secret: string) =>
  createHmac("sha256", secret).update(value, "utf8").digest("base64url");

function sameValue(left: string, right: string): boolean {
  return (
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export function createGoogleCalendarOAuthAttempt(
  userId: number,
  returnTo: string | null | undefined,
  secret: string,
  nowMs = Date.now(),
) {
  const attempt: OAuthAttempt = {
    codeVerifier: randomBytes(32).toString("base64url"),
    expiresAt: nowMs + ATTEMPT_TTL_MS,
    issuedAt: nowMs,
    nonce: randomBytes(32).toString("base64url"),
    returnTo: safeGoogleCalendarReturnTo(returnTo),
    state: randomBytes(32).toString("base64url"),
    userId,
    version: 1,
  };
  const encoded = Buffer.from(JSON.stringify(attempt), "utf8").toString(
    "base64url",
  );
  return {
    codeChallenge: createHash("sha256")
      .update(attempt.codeVerifier, "utf8")
      .digest("base64url"),
    cookieValue: `${encoded}.${sign(encoded, secret)}`,
    nonce: attempt.nonce,
    state: attempt.state,
  };
}

export function verifyGoogleCalendarOAuthAttempt(
  cookieValue: string | null | undefined,
  returnedState: string | null | undefined,
  secret: string,
  nowMs = Date.now(),
): OAuthAttempt | null {
  if (!cookieValue || !returnedState || cookieValue.length > 4096) return null;
  const [encoded, suppliedSignature, extra] = cookieValue.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  if (!sameValue(suppliedSignature, sign(encoded, secret))) return null;
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<OAuthAttempt>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.userId) ||
      typeof value.state !== "string" ||
      !sameValue(value.state, returnedState) ||
      typeof value.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) ||
      typeof value.codeVerifier !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.codeVerifier) ||
      typeof value.issuedAt !== "number" ||
      value.issuedAt > nowMs + 60_000 ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt < nowMs ||
      typeof value.returnTo !== "string" ||
      safeGoogleCalendarReturnTo(value.returnTo) !== value.returnTo
    ) {
      return null;
    }
    return value as OAuthAttempt;
  } catch {
    return null;
  }
}

async function readBoundedJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new Error("Google OAuth returned an invalid response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Google OAuth returned an invalid response");
    }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("Google OAuth returned an invalid response");
  }
}

function parseToken(
  data: Record<string, unknown>,
  nowMs: number,
): GoogleCalendarToken {
  const accessToken =
    typeof data.access_token === "string" ? data.access_token.trim() : "";
  const refreshToken =
    typeof data.refresh_token === "string" ? data.refresh_token.trim() : "";
  const expiresIn = Number(data.expires_in);
  if (
    !accessToken ||
    accessToken.length > MAX_TOKEN_LENGTH ||
    refreshToken.length > MAX_TOKEN_LENGTH ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_EXPIRES_IN_SECONDS
  ) {
    throw new Error("Google OAuth returned an invalid token");
  }
  return {
    accessToken,
    expiresAt: new Date(nowMs + expiresIn * 1000),
    ...(refreshToken ? { refreshToken } : {}),
  };
}

async function tokenRequest(
  body: URLSearchParams,
  nowMs: number,
  fetcher: typeof fetch,
) {
  const response = await fetcher(GOOGLE_CALENDAR_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await readBoundedJson(response);
  if (!response.ok) {
    const oauthError =
      typeof data.error === "string" ? data.error.slice(0, 100) : null;
    throw new GoogleOAuthRequestError(response.status, oauthError);
  }
  return { data, token: parseToken(data, nowMs) };
}

const googleJwks = createRemoteJWKSet(new URL(GOOGLE_CALENDAR_JWKS_URL));

export async function exchangeGoogleCalendarCode(
  input: {
    code: string;
    codeVerifier: string;
    nonce: string;
    redirectUri: string;
  },
  config: GoogleCalendarOAuthConfig,
  nowMs = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<GoogleCalendarToken & GoogleIdentity> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });
  const { data, token } = await tokenRequest(body, nowMs, fetcher);
  const idToken = typeof data.id_token === "string" ? data.id_token : "";
  if (!idToken || idToken.length > MAX_TOKEN_LENGTH) {
    throw new Error("Google OAuth returned an invalid identity");
  }
  const { payload } = await jwtVerify(idToken, googleJwks, {
    audience: config.clientId,
    currentDate: new Date(nowMs),
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (
    payload.nonce !== input.nonce ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    (payload.email !== undefined && payload.email_verified !== true)
  ) {
    throw new Error("Google OAuth returned an invalid identity");
  }
  return {
    ...token,
    email: typeof payload.email === "string" ? payload.email : null,
    subject: payload.sub,
  };
}

export async function refreshGoogleCalendarToken(
  refreshToken: string,
  config: GoogleCalendarOAuthConfig,
  nowMs = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<GoogleCalendarToken> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return (await tokenRequest(body, nowMs, fetcher)).token;
}
