import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getRedis } from "@/lib/redis";

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60_000;
const MAX_STATE_LENGTH = 2048;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const GITHUB_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

export const GITHUB_INSTALL_ATTEMPT_COOKIE = "ht_github_install_attempt";
export const GITHUB_INSTALL_ATTEMPT_COOKIE_PATH = "/api/github";
export const GITHUB_INSTALL_ATTEMPT_MAX_AGE_SECONDS = STATE_TTL_MS / 1000;

export type GithubInstallPhase = "install" | "authorize";

export type GithubInstallState = {
  expiresAt: number;
  installationId: string | null;
  issuedAt: number;
  nonce: string;
  phase: GithubInstallPhase;
  projectId: number;
  teamId: string;
  userId: number;
  version: 1;
};

export type GithubInstallAttemptInput = Pick<
  GithubInstallState,
  "installationId" | "phase" | "projectId" | "teamId" | "userId"
>;

const sign = (value: string, secret: string) =>
  createHmac("sha256", secret).update(value, "utf8").digest("base64url");

function sameValue(left: string, right: string): boolean {
  return (
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export function githubPkceVerifier(nonce: string, secret: string): string {
  return sign(`pkce.${nonce}`, secret);
}

export function githubPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function isGithubId(value: unknown): value is string {
  return typeof value === "string" && GITHUB_ID_PATTERN.test(value);
}

export function createGithubInstallAttempt(
  input: GithubInstallAttemptInput,
  secret: string,
  nowMs = Date.now(),
): { nonce: string; state: string } {
  const payload: GithubInstallState = {
    ...input,
    expiresAt: nowMs + STATE_TTL_MS,
    issuedAt: nowMs,
    nonce: randomBytes(32).toString("base64url"),
    version: 1,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { nonce: payload.nonce, state: `${encoded}.${sign(encoded, secret)}` };
}

export function verifyGithubInstallState(
  state: string | null | undefined,
  cookieNonce: string | null | undefined,
  expectedPhase: GithubInstallPhase,
  secret: string,
  nowMs = Date.now(),
): GithubInstallState | null {
  if (!state || !cookieNonce || state.length > MAX_STATE_LENGTH) return null;
  const [encoded, signature, extra] = state.split(".");
  if (!encoded || !signature || extra !== undefined) return null;
  if (!sameValue(signature, sign(encoded, secret))) return null;
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<GithubInstallState>;
    const installationIdValid =
      expectedPhase === "install"
        ? value.installationId === null
        : isGithubId(value.installationId);
    if (
      value.version !== 1 ||
      value.phase !== expectedPhase ||
      !installationIdValid ||
      typeof value.nonce !== "string" ||
      !NONCE_PATTERN.test(value.nonce) ||
      !sameValue(value.nonce, cookieNonce) ||
      !Number.isSafeInteger(value.userId) ||
      !Number.isSafeInteger(value.projectId) ||
      typeof value.teamId !== "string" ||
      !value.teamId ||
      typeof value.issuedAt !== "number" ||
      value.issuedAt > nowMs + MAX_CLOCK_SKEW_MS ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt - value.issuedAt !== STATE_TTL_MS ||
      value.expiresAt <= nowMs
    ) {
      return null;
    }
    return value as GithubInstallState;
  } catch {
    return null;
  }
}

export async function consumeGithubInstallNonce(
  nonce: string,
): Promise<"consumed" | "reused" | "unavailable"> {
  const key = `github-install:htpr-7515:nonce:${createHash("sha256").update(nonce, "utf8").digest("hex")}`;
  try {
    const redis = await getRedis();
    const claimed = await redis.set(key, "1", "EX", STATE_TTL_MS / 1000, "NX");
    return claimed === "OK" ? "consumed" : "reused";
  } catch (error) {
    console.error(
      "GitHub install attempt store unavailable; refusing the attempt",
      error instanceof Error ? error.message : "unknown error",
    );
    return "unavailable";
  }
}
