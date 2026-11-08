import { FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7515-connect-github-per-board";
import prisma from "@/lib/prisma";

import {
  resolveBoardGithubRepository,
  type BoardGithubRepositoryMapping,
} from "./boardConnections";

const ROLLOUT_USER_IDS = [FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_QA_USER_ID];

async function installedConnectionsEnabled(): Promise<boolean> {
  for (const userId of ROLLOUT_USER_IDS) {
    if (await isFeatureEnabled(HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG, userId)) {
      return true;
    }
  }
  return false;
}

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

  if (mapping.provenance === "installed" && !(await installedConnectionsEnabled())) {
    return null;
  }

  return { boardId, mapping };
}
