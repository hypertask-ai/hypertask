import prisma from "@/lib/prisma";

/**
 * Only the team owner may manage BYOK API keys.
 * There is no admin role in the Member_Team schema, so membership alone
 * does not grant access.
 */
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
