import type { BoardGithubRepositoryMapping } from "@/lib/github/boardConnections";
import { resolveBoardGithubRepository } from "@/lib/github/boardConnections";

export type PullRequestLifecycle = "open" | "closed" | "merged";
export type PullRequestCheckState = "pending" | "passing" | "failing";
export type PullRequestDisplayState =
  | "open"
  | "checks_red"
  | "green"
  | "merged";

export interface ParsedGithubPullRequestUrl {
  owner: string;
  repository: string;
  number: number;
  url: string;
}

const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

export function parseGithubPullRequestUrl(
  value: unknown,
): ParsedGithubPullRequestUrl | null {
  if (typeof value !== "string" || value.length > 500) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[2] !== "pull") return null;

  const [rawOwner, rawRepository, , rawNumber] = parts;
  if (!GITHUB_NAME.test(rawOwner) || !GITHUB_NAME.test(rawRepository)) {
    return null;
  }

  const number = Number(rawNumber);
  if (!Number.isSafeInteger(number) || number <= 0) return null;

  const owner = rawOwner.toLowerCase();
  const repository = rawRepository.toLowerCase();
  return {
    owner,
    repository,
    number,
    url: `https://github.com/${owner}/${repository}/pull/${number}`,
  };
}

const LEGACY_BOARD_15_PULL_REQUEST_AUTHOR_IDS = new Set([
  "3296316",
  "340644717",
  "49699333",
]);

export function isAuthorizedPullRequestAuthor(
  boardId: number,
  authorId: number,
  mapping?: Pick<BoardGithubRepositoryMapping, "provenance"> | null,
): boolean {
  if (mapping?.provenance === "installed") return true;
  return (
    boardId === 15 &&
    LEGACY_BOARD_15_PULL_REQUEST_AUTHOR_IDS.has(String(authorId))
  );
}

export function boardForGithubRepository(
  repository: {
    fullName?: unknown;
    isPrivate?: unknown;
    isFork?: unknown;
  },
  mappings: readonly BoardGithubRepositoryMapping[] = [],
): number | null {
  return resolveBoardGithubRepository(repository, mappings);
}

export function isStaleCheckSuiteObservation(
  existing: { headSha: string; sourceUpdatedAt: Date } | null,
  incoming: { headSha: string; sourceUpdatedAt: Date },
): boolean {
  return Boolean(
    existing &&
      existing.headSha === incoming.headSha &&
      existing.sourceUpdatedAt >= incoming.sourceUpdatedAt,
  );
}

export function checkStateFromSuites(
  suites: Array<{ status: string; conclusion: string | null }>,
): PullRequestCheckState {
  const failureConclusions = new Set([
    "action_required",
    "cancelled",
    "failure",
    "stale",
    "startup_failure",
    "timed_out",
  ]);
  if (
    suites.some(
      (suite) =>
        suite.status === "completed" &&
        suite.conclusion !== null &&
        failureConclusions.has(suite.conclusion),
    )
  ) {
    return "failing";
  }
  if (
    suites.length > 0 &&
    suites.every(
      (suite) =>
        suite.status === "completed" &&
        ["neutral", "skipped", "success"].includes(suite.conclusion ?? ""),
    )
  ) {
    return "passing";
  }
  return "pending";
}

export function derivePullRequestDisplayState(
  lifecycle: PullRequestLifecycle,
  checkState: PullRequestCheckState | null,
): PullRequestDisplayState {
  if (lifecycle === "merged") return "merged";
  if (lifecycle === "closed" || checkState === "failing") {
    return "checks_red";
  }
  if (checkState === "passing") return "green";
  return "open";
}
