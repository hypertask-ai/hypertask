import { HTPR_7035_DEMO_LOGIN_OWN_BOARD_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";

const boardSelect = { id: true, team: { select: { id: true, title: true } } } as const;

// undefined retains legacy behavior when Off; null means no accessible board exists.
export async function resolveLoginBoard(userId: number, previousBoard?: string | null) {
  if (!await isFeatureEnabled(HTPR_7035_DEMO_LOGIN_OWN_BOARD_FLAG, userId).catch(() => false)) {
    return undefined;
  }

  const previousId = previousBoard?.split("|&|")[0].match(/^project-([1-9]\d*)$/)?.[1];
  const membership = { members: { some: { userId, agentId: null } } };
  if (previousId && Number.isSafeInteger(Number(previousId))) {
    const board = await prisma.project.findFirst({
      where: {
        id: Number(previousId),
        status: "Normal",
        teamId: { not: null },
        OR: [{ ownerId: userId }, membership],
      },
      select: boardSelect,
    });
    if (board) return board;
  }

  // Adoption has already run: the demo remains eligible only if this account can access it.
  return await prisma.project.findFirst({
    where: { ownerId: userId, status: "Normal", teamId: { not: null } },
    orderBy: { id: "asc" },
    select: boardSelect,
  }) ?? await prisma.project.findFirst({
    where: { status: "Normal", teamId: { not: null }, ...membership },
    orderBy: { id: "asc" },
    select: boardSelect,
  });
}
