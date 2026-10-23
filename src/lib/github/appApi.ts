import { createPrivateKey, sign } from "node:crypto";

import { readBoundedGoogleJson } from "@/lib/googleCalendar/response";

import { getGithubAppConfig, getGithubAppPrivateKey } from "./appConfig";
import { GithubRequestError } from "./userApi";

const GITHUB_API_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REPOSITORIES_PER_PAGE = 100;
const MAX_REPOSITORY_PAGES = 10;

export type GithubInstallationRepository = {
  id: string;
  fullName: string;
  isPrivate: boolean;
  isFork: boolean;
};

async function createAppJwt(): Promise<string> {
  const config = await getGithubAppConfig();
  const privateKey = await getGithubAppPrivateKey();
  if (!config || !privateKey) throw new GithubRequestError(503);
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "rsa") throw new GithubRequestError(503);
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

async function appRequest(
  path: string,
  token: string,
  method: "GET" | "POST",
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetcher(`${GITHUB_API_URL}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Hypertask-GitHub-Connect",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== (method === "POST" ? 201 : 200)) {
    await response.body?.cancel();
    throw new GithubRequestError(response.status);
  }
  return readBoundedGoogleJson(response, MAX_RESPONSE_BYTES, "Invalid GitHub response");
}

function githubId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value : null;
}

export async function fetchInstallationToken(
  installationId: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  try {
    if (!githubId(installationId)) throw new GithubRequestError(400);
    const body = await appRequest(
      `/app/installations/${installationId}/access_tokens`,
      await createAppJwt(),
      "POST",
      fetcher,
    );
    if (typeof body.token !== "string" || !body.token.trim() || body.token.length > 2048) {
      throw new GithubRequestError(502);
    }
    return body.token;
  } catch (error) {
    throw error instanceof GithubRequestError ? error : new GithubRequestError(503);
  }
}

function parseRepository(value: unknown): GithubInstallationRepository {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GithubRequestError(502);
  const repository = value as Record<string, unknown>;
  const id = githubId(repository.id);
  if (
    !id ||
    typeof repository.full_name !== "string" ||
    repository.full_name.length > 201 ||
    !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository.full_name) ||
    typeof repository.private !== "boolean" ||
    typeof repository.fork !== "boolean"
  ) {
    throw new GithubRequestError(502);
  }
  return {
    id,
    fullName: repository.full_name.toLowerCase(),
    isPrivate: repository.private,
    isFork: repository.fork,
  };
}

export async function listInstallationRepositories(
  installationId: string,
  fetcher: typeof fetch = fetch,
): Promise<GithubInstallationRepository[]> {
  try {
    const token = await fetchInstallationToken(installationId, fetcher);
    const repositories: GithubInstallationRepository[] = [];
    const ids = new Set<string>();
    let total: number | null = null;
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const body = await appRequest(
        `/installation/repositories?per_page=${REPOSITORIES_PER_PAGE}&page=${page}`,
        token,
        "GET",
        fetcher,
      );
      if (
        !Array.isArray(body.repositories) ||
        body.repositories.length > REPOSITORIES_PER_PAGE ||
        typeof body.total_count !== "number" ||
        !Number.isSafeInteger(body.total_count) ||
        body.total_count < 0 ||
        body.total_count > REPOSITORIES_PER_PAGE * MAX_REPOSITORY_PAGES ||
        (total !== null && total !== body.total_count)
      ) {
        throw new GithubRequestError(502);
      }
      total = body.total_count;
      for (const value of body.repositories) {
        const repository = parseRepository(value);
        if (ids.has(repository.id)) throw new GithubRequestError(502);
        ids.add(repository.id);
        repositories.push(repository);
      }
      if (repositories.length === total) return repositories;
      if (repositories.length > total || body.repositories.length < REPOSITORIES_PER_PAGE) {
        throw new GithubRequestError(502);
      }
    }
    throw new GithubRequestError(502);
  } catch (error) {
    throw error instanceof GithubRequestError ? error : new GithubRequestError(503);
  }
}
