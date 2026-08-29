import prisma from "@/lib/prisma";

/** True when the user owns, belongs to, or can access a board on the team. */
export async function hasTeamMembershipAccess(
  userId: number,
  teamId: string
): Promise<boolean> {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      OR: [
        { googleAccount: { is: { userId } } },
        { members: { some: { userId, status: "Accepted" } } },
        {
          projects: {
            some: {
              status: "Normal",
              OR: [
                { ownerId: userId },
                { members: { some: { userId, agentId: null } } },
              ],
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  return Boolean(team);
}
