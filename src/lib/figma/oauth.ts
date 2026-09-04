import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { FIGMA_API_BASE_URL, FIGMA_SETTINGS_PATH } from "./paths";

export const FIGMA_OAUTH_ATTEMPT_MAX_AGE_SECONDS = 10 * 60;
// Browsers cap persistent cookies at 400 days; this version should survive
// normal sessions and change only when Figma authorization changes.
export const FIGMA_CONNECTION_VERSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const ATTEMPT_TTL_MS = FIGMA_OAUTH_ATTEMPT_MAX_AGE_SECONDS * 1000;
const FIGMA_REQUEST_TIMEOUT_MS = 5000;
const MAX_OAUTH_RESPONSE_BYTES = 32 * 1024;
const MAX_TOKEN_LENGTH = 8192;
const MAX_EXPIRES_IN_SECONDS = 400 * 24 * 60 * 60;
const MAX_RETURN_TO_LENGTH = 2000;

export const FIGMA_OAUTH_ATTEMPT_COOKIE = "ht_figma_oauth";
export const FIGMA_CONNECTION_VERSION_COOKIE = "ht_figma_connection";

export type FigmaOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

export type FigmaToken = {
  accessToken: string;
  expiresAt: Date;
  refreshToken?: string;
  userId?: string;
};

type FigmaOAuthAttempt = {
  codeVerifier: string;
  expiresAt: number;
  issuedAt: number;
  returnTo: string;
  state: string;
  userId: number;
  version: 1;
};

export class FigmaOAuthRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly oauthError: string | null,
  ) {
    super(`Figma OAuth request failed (${status})`);
  }
}

export function getFigmaOAuthConfig(): FigmaOAuthConfig | null {
  const clientId = process.env.FIGMA_CLIENT_ID?.trim();
  const clientSecret = process.env.FIGMA_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function safeFigmaReturnTo(value: string | null | undefined): string {
  const fallback = FIGMA_SETTINGS_PATH;
  if (
    !value ||
    value.length > MAX_RETURN_TO_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return fallback;
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
      return fallback;
    }
    const normalized = `${target.pathname}${target.search}${target.hash}`;
    return Buffer.byteLength(normalized, "utf8") <= MAX_RETURN_TO_LENGTH
      ? normalized
      : fallback;
  } catch {
    return fallback;
  }
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function sameValue(left: string, right: string): boolean {
  return (
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export function createFigmaOAuthAttempt(
  userId: number,
  returnTo: string | null | undefined,
  secret: string,
  nowMs = Date.now(),
) {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const attempt: FigmaOAuthAttempt = {
    codeVerifier,
    expiresAt: nowMs + ATTEMPT_TTL_MS,
    issuedAt: nowMs,
    returnTo: safeFigmaReturnTo(returnTo),
    state,
    userId,
    version: 1,
  };
  const encoded = Buffer.from(JSON.stringify(attempt), "utf8").toString(
    "base64url",
  );

  return {
    codeChallenge: createHash("sha256")
      .update(codeVerifier, "utf8")
      .digest("base64url"),
    cookieValue: `${encoded}.${signature(encoded, secret)}`,
    state,
  };
}

export function verifyFigmaOAuthAttempt(
  cookieValue: string | null | undefined,
  returnedState: string | null | undefined,
  secret: string,
  nowMs = Date.now(),
): FigmaOAuthAttempt | null {
  if (!cookieValue || !returnedState || cookieValue.length > 4096) return null;
  const [encoded, suppliedSignature, extra] = cookieValue.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expectedSignature = signature(encoded, secret);
  if (!sameValue(suppliedSignature, expectedSignature)) return null;

  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<FigmaOAuthAttempt>;
    if (
      value.version !== 1 ||
      !Number.isSafeInteger(value.userId) ||
      typeof value.state !== "string" ||
      !sameValue(value.state, returnedState) ||
      typeof value.codeVerifier !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.codeVerifier) ||
      typeof value.issuedAt !== "number" ||
      value.issuedAt > nowMs + 60_000 ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt < nowMs ||
      typeof value.returnTo !== "string" ||
      safeFigmaReturnTo(value.returnTo) !== value.returnTo
    ) {
      return null;
    }
    return value as FigmaOAuthAttempt;
  } catch {
    return null;
  }
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_OAUTH_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel();
    throw new Error("Figma OAuth returned an invalid response");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_OAUTH_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Figma OAuth returned an invalid response");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const parsed = JSON.parse(body.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Figma OAuth returned an invalid response");
  }
  return parsed as Record<string, unknown>;
}

async function requestToken(
  endpoint: "token" | "refresh",
  body: URLSearchParams,
  config: FigmaOAuthConfig,
  nowMs: number,
  fetcher: typeof fetch,
): Promise<FigmaToken> {
  const response = await fetcher(
    `${FIGMA_API_BASE_URL}/oauth/${endpoint}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(
          `${config.clientId}:${config.clientSecret}`,
          "utf8",
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(FIGMA_REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    let oauthError: string | null = null;
    try {
      const errorData = await readBoundedJson(response);
      oauthError =
        typeof errorData.error === "string"
          ? errorData.error.trim().toLowerCase().slice(0, 100)
          : null;
    } catch {
      // Preserve only the status when Figma does not return an OAuth JSON error.
    }
    throw new FigmaOAuthRequestError(response.status, oauthError);
  }

  const data = await readBoundedJson(response);
  const accessToken =
    typeof data.access_token === "string" ? data.access_token.trim() : "";
  const refreshToken =
    typeof data.refresh_token === "string" ? data.refresh_token.trim() : "";
  const userIdString =
    typeof data.user_id_string === "string" ? data.user_id_string.trim() : "";
  let legacyUserId = "";
  if (typeof data.user_id === "string") {
    legacyUserId = data.user_id.trim();
  } else if (
    typeof data.user_id === "number" &&
    Number.isSafeInteger(data.user_id)
  ) {
    legacyUserId = String(data.user_id);
  }
  const userIdCandidate = userIdString || legacyUserId;
  const userId = userIdCandidate.length <= 200 ? userIdCandidate : "";
  const expiresIn = Number(data.expires_in);
  if (
    !accessToken ||
    accessToken.length > MAX_TOKEN_LENGTH ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_EXPIRES_IN_SECONDS
  ) {
    throw new Error("Figma OAuth returned an invalid token");
  }

  return {
    accessToken,
    expiresAt: new Date(nowMs + expiresIn * 1000),
    ...(refreshToken ? { refreshToken } : {}),
    ...(userId ? { userId } : {}),
  };
}

export function exchangeFigmaCode(
  input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  },
  config: FigmaOAuthConfig,
  nowMs = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<FigmaToken> {
  return requestToken(
    "token",
    new URLSearchParams({
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
    config,
    nowMs,
    fetcher,
  );
}

export function refreshFigmaToken(
  refreshToken: string,
  config: FigmaOAuthConfig,
  nowMs = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<FigmaToken> {
  return requestToken(
    "refresh",
    new URLSearchParams({ refresh_token: refreshToken }),
    config,
    nowMs,
    fetcher,
  );
}

export async function getFigmaUserName(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetcher(`${FIGMA_API_BASE_URL}/me`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(FIGMA_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const data = await readBoundedJson(response);
  return typeof data.handle === "string" && data.handle.trim()
    ? data.handle.trim().slice(0, 200)
    : null;
}
