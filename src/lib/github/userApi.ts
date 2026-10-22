import { readBoundedGoogleJson } from "@/lib/googleCalendar/response";

import type { GithubAppConfig } from "./appConfig";

const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const INSTALLATIONS_PER_PAGE = 100;
const MAX_INSTALLATION_PAGES = 10;
const MAX_TOKEN_LENGTH = 2048;
const INVALID_RESPONSE = "GitHub returned an invalid response";

export class GithubRequestError extends Error {
  constructor(public readonly status: number) {
    super(`GitHub request failed (${status})`);
  }
}

export type GithubUser = { id: string; login: string };

export type GithubUserInstallation = {
  accountId: string;
  accountLogin: string;
  accountType: "Organization" | "User";
  appId: string;
  id: string;
  suspended: boolean;
};

export type GithubOrgMembership =
  | { httpStatus: 200; organizationId: string | null; role: string | null; state: string | null }
  | { httpStatus: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function githubId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value : null;
}

function githubLogin(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(value)
    ? value
    : null;
}

async function githubUserGet(
  path: string,
  userToken: string,
  fetcher: typeof fetch,
): Promise<{ body: Record<string, unknown> | null; status: number }> {
  const response = await fetcher(`${GITHUB_API_URL}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${userToken}`,
      "User-Agent": "Hypertask-GitHub-Connect",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    return { body: null, status: response.status };
  }
  return {
    body: await readBoundedGoogleJson(response, MAX_RESPONSE_BYTES, INVALID_RESPONSE),
    status: 200,
  };
}

async function requireGithubUserGet(
  path: string,
  userToken: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const { body, status } = await githubUserGet(path, userToken, fetcher);
  if (!body) throw new GithubRequestError(status);
  return body;
}

export async function exchangeGithubUserCode(
  input: { code: string; codeVerifier: string; redirectUri: string },
  config: Pick<GithubAppConfig, "clientId" | "clientSecret">,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GithubRequestError(response.status);
  }
  const data = await readBoundedGoogleJson(response, MAX_RESPONSE_BYTES, INVALID_RESPONSE);
  const userToken = typeof data.access_token === "string" ? data.access_token.trim() : "";
  if (!userToken || userToken.length > MAX_TOKEN_LENGTH || data.token_type !== "bearer") {
    throw new GithubRequestError(400);
  }
  return userToken;
}

export async function fetchGithubUser(
  userToken: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubUser> {
  const body = await requireGithubUserGet("/user", userToken, fetcher);
  const id = githubId(body.id);
  const login = githubLogin(body.login);
  if (!id || !login) throw new Error(INVALID_RESPONSE);
  return { id, login };
}

function parseInstallation(value: unknown): GithubUserInstallation | null {
  if (!isRecord(value) || !isRecord(value.account)) return null;
  const id = githubId(value.id);
  const appId = githubId(value.app_id);
  const accountId = githubId(value.account.id);
  const accountLogin = githubLogin(value.account.login);
  const accountType = value.account.type;
  if (
    !id ||
    !appId ||
    !accountId ||
    !accountLogin ||
    (accountType !== "Organization" && accountType !== "User")
  ) {
    return null;
  }
  return {
    accountId,
    accountLogin,
    accountType,
    appId,
    id,
    suspended: value.suspended_at !== null && value.suspended_at !== undefined,
  };
}

export async function findGithubUserInstallation(
  userToken: string,
  installationId: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubUserInstallation | null> {
  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page += 1) {
    const body = await requireGithubUserGet(
      `/user/installations?per_page=${INSTALLATIONS_PER_PAGE}&page=${page}`,
      userToken,
      fetcher,
    );
    if (!Array.isArray(body.installations)) throw new Error(INVALID_RESPONSE);
    const match = body.installations.find(
      (entry) => isRecord(entry) && githubId(entry.id) === installationId,
    );
    if (match) {
      const installation = parseInstallation(match);
      if (!installation) throw new Error(INVALID_RESPONSE);
      return installation;
    }
    if (body.installations.length < INSTALLATIONS_PER_PAGE) return null;
  }
  return null;
}

export async function fetchGithubOrgMembership(
  userToken: string,
  orgLogin: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubOrgMembership> {
  const { body, status } = await githubUserGet(
    `/user/memberships/orgs/${encodeURIComponent(orgLogin)}`,
    userToken,
    fetcher,
  );
  if (!body) return { httpStatus: status };
  return {
    httpStatus: 200,
    organizationId: isRecord(body.organization) ? githubId(body.organization.id) : null,
    role: typeof body.role === "string" ? body.role : null,
    state: typeof body.state === "string" ? body.state : null,
  };
}
