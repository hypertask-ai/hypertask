import prisma from "@/lib/prisma";
import { fetchInstallationToken } from "@/lib/github/appApi";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9266_BOARD_PRIVATE_PULL_REQUEST_LINK_FLAG } from "@/lib/flags/definitions/htpr-9266-board-private-pull-request-link";
import type { ParsedGithubPullRequestUrl } from "./githubPullRequests";

type BoardRepositoryRow = {
  installationId: string | null;
  repositoryId: string | null;
};

export type BoardPullRequestAccessDb = {
  boardGithubRepository: {
    findFirst: (args: unknown) => Promise<BoardRepositoryRow | null>;
  };
};

type BoardPullRequestAccessDependencies = {
  db?: BoardPullRequestAccessDb;
  enabled?: (userId: number) => Promise<boolean>;
  installationToken?: (installationId: string, repositoryId: string) => Promise<string>;
};

export async function boardPullRequestAuthorization(
  projectId: number,
  parsed: ParsedGithubPullRequestUrl,
  userId: number,
  {
    db = prisma as unknown as BoardPullRequestAccessDb,
    enabled = (id: number) =>
      isFeatureEnabled(HTPR_9266_BOARD_PRIVATE_PULL_REQUEST_LINK_FLAG, id),
    installationToken = (installationId: string, repositoryId: string) =>
      fetchInstallationToken(installationId, fetch, { repositoryId }),
  }: BoardPullRequestAccessDependencies = {},
): Promise<string | null> {
  try {
    if (!(await enabled(userId))) return null;

    const mapping = await db.boardGithubRepository.findFirst({
      where: {
        projectId,
        fullName: `${parsed.owner}/${parsed.repository}`,
        provenance: "installed",
        revokedAt: null,
        installationId: { not: null },
        repositoryId: { not: null },
      },
      select: { installationId: true, repositoryId: true },
    });
    if (!mapping?.installationId || !mapping.repositoryId) return null;

    return `Bearer ${await installationToken(mapping.installationId, mapping.repositoryId)}`;
  } catch {
    return null;
  }
}
