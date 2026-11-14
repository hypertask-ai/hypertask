import prisma from "@/lib/prisma";

import {
  githubRepositoryId,
  resolveBoardGithubRepository,
  type BoardGithubRepositoryMapping,
} from "./boardConnections";

export async function lookupBoardForGithubRepository(repository: {
  fullName?: unknown;
  id?: unknown;
  isPrivate?: unknown;
  isFork?: unknown;
}): Promise<{ boardId: number; mapping: BoardGithubRepositoryMapping } | null> {
  if (typeof repository.fullName !== "string") return null;

  const fullName = repository.fullName.toLowerCase();
  const repositoryId = githubRepositoryId(repository.id);
  const rows = await prisma.boardGithubRepository.findMany({
    where: repositoryId
      ? {
          revokedAt: null,
          OR: [
            { repositoryId },
            { repositoryId: null, fullName },
          ],
        }
      : { fullName, revokedAt: null },
    select: {
      projectId: true,
      fullName: true,
      repositoryId: true,
      provenance: true,
      installationId: true,
      revokedAt: true,
    },
  });

  const boardId = resolveBoardGithubRepository(repository, rows);
  if (boardId === null) return null;

  const mapping = rows.find(
    (row) =>
      row.revokedAt === null &&
      row.projectId === boardId &&
      resolveBoardGithubRepository(repository, [row]) === boardId,
  );
  if (!mapping) return null;

  return { boardId, mapping };
}
