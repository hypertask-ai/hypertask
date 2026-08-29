import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export async function withLockedTeamAiSettings<T>(
  teamId: string,
  run: (
    transaction: Prisma.TransactionClient,
    currentSettings: unknown,
  ) => Promise<T>,
) {
  return prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<
      Array<{ aiProviderSettings: Prisma.JsonValue | null }>
    >`SELECT "aiProviderSettings" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
    const team = rows[0];
    if (!team) return null;
    return run(transaction, team.aiProviderSettings);
  });
}

export async function updateTeamAiSettingsAtomically(
  teamId: string,
  buildNextSettings: (currentSettings: unknown) => Record<string, unknown>,
) {
  return withLockedTeamAiSettings(
    teamId,
    async (transaction, currentSettings) => {
      const nextSettings = buildNextSettings(currentSettings);
      await transaction.team.update({
        where: { id: teamId },
        data: { aiProviderSettings: nextSettings as Prisma.InputJsonValue },
      });
      return nextSettings;
    },
  );
}
