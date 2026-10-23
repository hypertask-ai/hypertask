import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

import { findBoardGithubAdmin } from "./installAuthority";
import type { GithubUserInstallation } from "./userApi";

export type GithubAdoptionResult = "connected" | "board_access_denied" | "installation_bound_elsewhere";

class InstallationBoundElsewhereError extends Error {}
class BoardAccessDeniedError extends Error {}

export async function adoptGithubInstallation(input: {
  installation: GithubUserInstallation;
  projectId: number;
  teamId: string;
  userId: number;
}): Promise<GithubAdoptionResult> {
  const { installation, projectId, teamId, userId } = input;
  const identity = {
    accountId: installation.accountId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
  };
  try {
    await prisma.$transaction(async (tx) => {
      const admin = await findBoardGithubAdmin(userId, projectId, tx);
      if (!admin || admin.teamId !== teamId) throw new BoardAccessDeniedError();

      const existing = await tx.githubInstallation.findUnique({
        where: { id: installation.id },
        select: { teamId: true },
      });
      if (existing && existing.teamId !== teamId) {
        throw new InstallationBoundElsewhereError();
      }
      if (existing) {
        await tx.githubInstallation.update({
          where: { id: installation.id },
          data: { ...identity, revokedAt: null },
        });
        return;
      }
      await tx.githubInstallation.create({
        data: { id: installation.id, teamId, ...identity },
      });
    });
    return "connected";
  } catch (error) {
    if (error instanceof BoardAccessDeniedError) return "board_access_denied";
    if (
      error instanceof InstallationBoundElsewhereError ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      return "installation_bound_elsewhere";
    }
    throw error;
  }
}
