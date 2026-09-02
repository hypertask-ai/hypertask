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

const BOARD_15_GITHUB_REPOSITORIES = new Set([
  "hypertask-ai/android",
  "hypertask-ai/app-releases",
  "hypertask-ai/cli",
  "hypertask-ai/docs",
  "hypertask-ai/hypertask",
  "hypertask-ai/skills",
]);

export function boardForGithubRepository(repository: {
  fullName?: unknown;
  isPrivate?: unknown;
  isFork?: unknown;
}): number | null {
  if (
    typeof repository.fullName !== "string" ||
    repository.isPrivate !== false ||
    repository.isFork !== false
  ) {
    return null;
  }
  return BOARD_15_GITHUB_REPOSITORIES.has(repository.fullName.toLowerCase())
    ? 15
    : null;
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
