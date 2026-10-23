import { createHash, createHmac, createPrivateKey, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { readBoundedGoogleJson } from "@/lib/googleCalendar/response";
import { getRedis } from "@/lib/redis";

import { encryptGithubAppCredential, preflightGithubAppCredentialKey } from "./appCredentialCipher";

export const GITHUB_APP_MANIFEST_COOKIE = "ht_github_app_manifest";
export const GITHUB_APP_MANIFEST_COOKIE_PATH = "/api/github/app-manifest";
export const GITHUB_APP_MANIFEST_TTL_SECONDS = 600;
const STATE_TTL_MS = GITHUB_APP_MANIFEST_TTL_SECONDS * 1000;
const MAX_CLOCK_SKEW_MS = 60_000;

type ManifestState = { userId: number; nonce: string; issuedAt: number; expiresAt: number };

function stateSignature(encoded: string): string {
  const secret = process.env.BYOK_CIPHER_SECRET;
  if (!secret || secret.length < 16) throw new Error("state_key_unavailable");
  const key = Buffer.from(hkdfSync(
    "sha256", Buffer.from(secret, "utf8"),
    "hypertask-github-app-manifest-state-v1", "hypertask-github-app-manifest-state-v1", 32,
  ));
  return createHmac("sha256", key).update(encoded, "utf8").digest("base64url");
}

function sameValue(left: string, right: string): boolean {
  return Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function createGithubAppManifestState(userId: number, nowMs = Date.now()) {
  preflightGithubAppCredentialKey();
  const nonce = randomBytes(32).toString("base64url");
  const encoded = Buffer.from(JSON.stringify({
    userId, nonce, issuedAt: nowMs, expiresAt: nowMs + STATE_TTL_MS,
  })).toString("base64url");
  return { nonce, state: `${encoded}.${stateSignature(encoded)}` };
}

export function verifyGithubAppManifestState(
  state: string | null,
  cookieNonce: string | undefined,
  userId: number,
  nowMs = Date.now(),
): ManifestState | null {
  try {
    if (!state || state.length > 2048 || !cookieNonce) return null;
    const [encoded, signature, extra] = state.split(".");
    if (!encoded || !signature || extra !== undefined || !sameValue(signature, stateSignature(encoded))) return null;
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ManifestState;
    if (
      !value || value.userId !== userId || !Number.isSafeInteger(value.userId) ||
      typeof value.nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) ||
      !sameValue(value.nonce, cookieNonce) ||
      !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
      value.issuedAt > nowMs + MAX_CLOCK_SKEW_MS || value.expiresAt <= nowMs ||
      value.expiresAt - value.issuedAt !== STATE_TTL_MS
    ) return null;
    return value;
  } catch {
    return null;
  }
}

export async function consumeGithubAppManifestNonce(nonce: string): Promise<boolean> {
  const redis = await getRedis();
  const hash = createHash("sha256").update(nonce, "utf8").digest("hex");
  return (await redis.set(
    `github-app-manifest:htpr-7515:nonce:${hash}`, "1", "EX", GITHUB_APP_MANIFEST_TTL_SECONDS + MAX_CLOCK_SKEW_MS / 1000, "NX",
  )) === "OK";
}

export function githubAppManifest(origin: string) {
  return {
    name: "Hypertask",
    url: "https://app.hypertask.ai",
    redirect_url: `${origin}/api/github/app-manifest/callback`,
    setup_url: `${origin}/api/github/setup`,
    callback_urls: [`${origin}/api/github/oauth/callback`],
    request_oauth_on_install: false,
    setup_on_update: true,
    public: true,
    default_permissions: { pull_requests: "read", metadata: "read", checks: "read", members: "read" },
    default_events: ["pull_request", "check_suite"],
    hook_attributes: { url: `${origin}/api/webhooks/github-app`, active: false },
  };
}

function requiredString(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error("invalid_response");
  return value;
}

export async function convertGithubAppManifest(code: string, userId: number, fetcher: typeof fetch = fetch) {
  preflightGithubAppCredentialKey();
  const response = await fetcher(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Hypertask-GitHub-Connect",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(7000),
  });
  if (response.status !== 201) {
    await response.body?.cancel();
    throw new Error("conversion_failed");
  }
  const body = await readBoundedGoogleJson(response, 64 * 1024, "invalid_response");
  const owner = body.owner as { login?: unknown; type?: unknown } | null;
  if (owner?.login !== "hypertask-ai" || owner.type !== "Organization") throw new Error("invalid_owner");
  const appId = typeof body.id === "number" && Number.isSafeInteger(body.id) && body.id > 0
    ? String(body.id) : requiredString(body.id, 20);
  if (!/^[1-9][0-9]{0,19}$/.test(appId)) throw new Error("invalid_response");
  const slug = requiredString(body.slug, 100);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("invalid_response");
  const htmlUrl = requiredString(body.html_url, 256);
  if (htmlUrl !== `https://github.com/apps/${slug}`) throw new Error("invalid_response");
  const privateKey = requiredString(body.pem, 32 * 1024);
  if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa") throw new Error("invalid_response");
  return {
    appId,
    slug,
    ownerLogin: owner.login,
    htmlUrl,
    clientId: requiredString(body.client_id, 256),
    clientSecret: encryptGithubAppCredential("clientSecret", requiredString(body.client_secret, 2048)),
    privateKey: encryptGithubAppCredential("privateKey", privateKey),
    webhookSecret: encryptGithubAppCredential("webhookSecret", requiredString(body.webhook_secret, 2048)),
    stateSecret: encryptGithubAppCredential("stateSecret", randomBytes(32).toString("base64url")),
    createdByUserId: userId,
  };
}
