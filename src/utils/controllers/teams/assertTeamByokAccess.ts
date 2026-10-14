import prisma from "@/lib/prisma";

export async function assertUserCanManageTeamByok(
  userId: number,
  accountId: string | null | undefined,
  teamId: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      googleAccountId: true,
      googleAccount: { select: { userId: true } },
    },
  });

  if (!team) {
    return { ok: false, status: 404, message: "Team not found" };
  }

  if (
    team.googleAccount.userId === userId ||
    (accountId && accountId === team.googleAccountId)
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    message: "Only the team owner can manage API keys",
  };
}
