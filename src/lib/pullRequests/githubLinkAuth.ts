import { createHash, createPrivateKey, sign } from "node:crypto";

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_PAGES = 10;
const PAGE_SIZE = 100;
const FAILURE_PAUSE_MS = 60_000;
const EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TOKEN_MS = 45 * 60_000;

export const PULL_REQUEST_LINK_READ_PERMISSIONS = {
  metadata: "read",
  pull_requests: "read",
  checks: "read",
} as const;

const LIST_PERMISSIONS = {
  metadata: PULL_REQUEST_LINK_READ_PERMISSIONS.metadata,
} as const;

type CachedAuthorization = {
  fingerprint: string;
  authorization: string;
  expiresAt: number;
};

let cached: CachedAuthorization | null = null;
let pending: { fingerprint: string; promise: Promise<string | null> } | null = null;
let pausedUntil = 0;
let pausedFingerprint = "";

export function resetPullRequestGithubAuthCache(): void {
  cached = null;
  pending = null;
  pausedUntil = 0;
  pausedFingerprint = "";
}

function fingerprint(): string {
  return createHash("sha256")
    .update(process.env.GITHUB_PR_LINK_APP_ID ?? "")
    .update("\0")
    .update(process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY ?? "")
    .digest("hex");
}

function appConfig(): { appId: string; privateKey: string } | null {
  const appId = process.env.GITHUB_PR_LINK_APP_ID?.trim() ?? "";
  const privateKey = (process.env.GITHUB_PR_LINK_APP_PRIVATE_KEY ?? "")
    .trim()
    .replace(/\\n/g, "\n");
  if (!/^[1-9][0-9]{0,20}$/.test(appId) || !privateKey.includes("PRIVATE KEY")) {
    return null;
  }
  return { appId, privateKey };
}

function appJwt(config: { appId: string; privateKey: string }): string {
  const key = createPrivateKey(config.privateKey);
  if (key.asymmetricKeyType !== "rsa") {
    throw new Error("pull request github app key is not rsa");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: config.appId,
  })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function installationId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9][0-9]{0,20}$/.test(value)) return value;
  return null;
}

function publicRepositoryName(value: unknown): string | null {
  if (!isRecord(value) || value.private !== false) return null;
  if (typeof value.name !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(value.name)) return null;
  return value.name;
}

async function githubRequest(
  path: string,
  token: string,
  method: "GET" | "POST",
  body?: object,
): Promise<unknown> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Hypertask-Pull-Request-Linker",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new Error("github response too large");
  const expected = method === "POST" ? 201 : 200;
  if (response.status !== expected) throw new Error(`github status ${response.status}`);
  return JSON.parse(text) as unknown;
}

async function publicRepositoryNames(jwt: string, id: string): Promise<string[]> {
  const listed = await githubRequest(
    `/app/installations/${id}/access_tokens`,
    jwt,
    "POST",
    { permissions: LIST_PERMISSIONS },
  );
  if (!isRecord(listed) || typeof listed.token !== "string" || listed.token.length < 8) {
    throw new Error("github list token missing");
  }
  const names = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await githubRequest(
      `/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`,
      listed.token,
      "GET",
    );
    if (
      !isRecord(body) ||
      !Array.isArray(body.repositories) ||
      body.repositories.length > PAGE_SIZE
    ) {
      throw new Error("github repository list invalid");
    }
    for (const repo of body.repositories) {
      const name = publicRepositoryName(repo);
      if (name) names.add(name);
    }
    if (body.repositories.length < PAGE_SIZE) break;
  }
  return [...names];
}

function tokenExpiry(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) return Date.now() + DEFAULT_TOKEN_MS;
  return parsed - EXPIRY_SKEW_MS;
}

async function mintReadToken(
  jwt: string,
  id: string,
  repositories: string[],
): Promise<{ authorization: string; expiresAt: number }> {
  const body = await githubRequest(
    `/app/installations/${id}/access_tokens`,
    jwt,
    "POST",
    {
      repositories,
      permissions: PULL_REQUEST_LINK_READ_PERMISSIONS,
    },
  );
  if (!isRecord(body) || typeof body.token !== "string" || body.token.length < 8 || body.token.length > 2048) {
    throw new Error("github read token missing");
  }
  return {
    authorization: `Bearer ${body.token}`,
    expiresAt: tokenExpiry(body.expires_at),
  };
}

async function authorizationFromApp(config: {
  appId: string;
  privateKey: string;
}): Promise<{ authorization: string; expiresAt: number } | null> {
  const jwt = appJwt(config);
  const listed = await githubRequest("/app/installations", jwt, "GET");
  if (!Array.isArray(listed)) throw new Error("github installations invalid");
  for (const installation of listed) {
    if (!isRecord(installation) || installation.suspended_at) continue;
    const id = installationId(installation.id);
    if (!id) continue;
    const repositories = await publicRepositoryNames(jwt, id);
    if (repositories.length === 0) continue;
    return mintReadToken(jwt, id, repositories.slice(0, PAGE_SIZE));
  }
  return null;
}

async function loadAuthorization(fp: string): Promise<string | null> {
  const config = appConfig();
  if (!config) return null;
  try {
    const minted = await authorizationFromApp(config);
    if (!minted || minted.expiresAt <= Date.now()) {
      pausedFingerprint = fp;
      pausedUntil = Date.now() + FAILURE_PAUSE_MS;
      return null;
    }
    cached = {
      fingerprint: fp,
      authorization: minted.authorization,
      expiresAt: minted.expiresAt,
    };
    return minted.authorization;
  } catch {
    console.error("Pull request GitHub authentication is unavailable");
    pausedFingerprint = fp;
    pausedUntil = Date.now() + FAILURE_PAUSE_MS;
    return null;
  }
}

export async function pullRequestGithubAuthorization(): Promise<string | null> {
  const explicit = process.env.GITHUB_TOKEN;
  if (explicit) return `Bearer ${explicit}`;
  if (!appConfig()) return null;
  const fp = fingerprint();
  if (cached && cached.fingerprint === fp && cached.expiresAt > Date.now()) {
    return cached.authorization;
  }
  if (pausedFingerprint === fp && pausedUntil > Date.now()) return null;
  if (pending && pending.fingerprint === fp) return pending.promise;
  const promise = loadAuthorization(fp);
  pending = { fingerprint: fp, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = null;
  }
}
