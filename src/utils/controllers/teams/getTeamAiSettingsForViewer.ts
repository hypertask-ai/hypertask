import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export function teamAiSettingsViewerWhere(
  userId: number,
  accountId: string | undefined,
  teamId: string,
): Prisma.TeamWhereInput {
  return {
    id: teamId,
    OR: [
      { googleAccount: { is: { userId } } },
      ...(accountId ? [{ googleAccountId: accountId }] : []),
      { members: { some: { userId, status: "Accepted" } } },
    ],
  };
}

export async function getTeamAiSettingsForViewer(
  userId: number,
  accountId: string | undefined,
  teamId: string,
) {
  const team = await prisma.team.findFirst({
    where: teamAiSettingsViewerWhere(userId, accountId, teamId),
    select: { aiProviderSettings: true },
  });

  if (team) {
    return { ok: true as const, settings: team.aiProviderSettings };
  }

  const exists = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true },
  });

  return exists
    ? { ok: false as const, status: 403 as const, message: "Forbidden" }
    : { ok: false as const, status: 404 as const, message: "Team not found" };
}
