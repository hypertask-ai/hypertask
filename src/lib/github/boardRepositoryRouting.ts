import prisma from "@/lib/prisma";

import {
  resolveBoardGithubRepository,
  type BoardGithubRepositoryMapping,
} from "./boardConnections";

export async function lookupBoardForGithubRepository(repository: {
  fullName?: unknown;
  isPrivate?: unknown;
  isFork?: unknown;
}): Promise<{ boardId: number; mapping: BoardGithubRepositoryMapping } | null> {
  if (typeof repository.fullName !== "string") return null;

  const fullName = repository.fullName.toLowerCase();
  const rows = await prisma.boardGithubRepository.findMany({
    where: { fullName, revokedAt: null },
    select: {
      projectId: true,
      fullName: true,
      provenance: true,
      installationId: true,
      revokedAt: true,
    },
  });

  const boardId = resolveBoardGithubRepository(repository, rows);
  if (boardId === null) return null;

  const mapping = rows.find(
    (row) =>
      row.fullName === fullName &&
      row.revokedAt === null &&
      row.projectId === boardId,
  );
  if (!mapping) return null;

  return { boardId, mapping };
}
