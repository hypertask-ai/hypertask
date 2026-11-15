import prisma from "@/lib/prisma";
import { fetchInstallationToken } from "@/lib/github/appApi";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9266_BOARD_PRIVATE_PULL_REQUEST_LINK_FLAG } from "@/lib/flags/definitions/htpr-9266-board-private-pull-request-link";
import type { ParsedGithubPullRequestUrl } from "./githubPullRequests";

type BoardPullRequestAccessDb = {
  boardGithubRepository: {
    findFirst: (args: unknown) => Promise<{ installationId: string | null } | null>;
  };
};

type BoardPullRequestAccessDependencies = {
  db?: BoardPullRequestAccessDb;
  enabled?: (userId: number) => Promise<boolean>;
  installationToken?: (installationId: string) => Promise<string>;
};

export async function boardPullRequestAuthorization(
  projectId: number,
  parsed: ParsedGithubPullRequestUrl,
  userId: number,
  {
    db = prisma as unknown as BoardPullRequestAccessDb,
    enabled = (id: number) =>
      isFeatureEnabled(HTPR_9266_BOARD_PRIVATE_PULL_REQUEST_LINK_FLAG, id),
    installationToken = fetchInstallationToken,
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
      },
      select: { installationId: true },
    });
    if (!mapping?.installationId) return null;

    return `Bearer ${await installationToken(mapping.installationId)}`;
  } catch {
    return null;
  }
}
