import prisma from "@/lib/prisma";
import { computeSeatQuantity } from "@/lib/seatQuantity";

export async function resolveSeatQuantity(
  teamId: string | undefined,
  fallbackQuantity: number,
): Promise<number> {
  if (!teamId) return fallbackQuantity;
  try {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        totalSeats: true,
        googleAccount: { select: { userId: true } },
        members: {
          where: { status: "Accepted" },
          select: { userId: true, user: { select: { email: true } } },
        },
        projects: {
          where: { status: "Normal" },
          select: {
            invites: {
              where: { expired: false, key: { not: "public" } },
              select: { emails: true },
            },
          },
        },
      },
    });
    if (!team) return fallbackQuantity;

    const ownerEmail = team.googleAccount?.userId
      ? (
          await prisma.user.findUnique({
            where: { id: team.googleAccount.userId },
            select: { email: true },
          })
        )?.email
      : null;

    const acceptedUserIds = new Set([
      ...(team.googleAccount?.userId ? [team.googleAccount.userId] : []),
      ...team.members.map((member) => member.userId),
    ]);

    return computeSeatQuantity({
      totalSeats: acceptedUserIds.size || team.totalSeats,
      pendingInviteEmails: team.projects.flatMap((p) =>
        p.invites.map((i) => i.emails[0]),
      ),
      memberEmails: [ownerEmail, ...team.members.map((m) => m.user.email)],
    });
  } catch (e) {
    console.error(
      e,
      "resolveSeatQuantity failed, falling back to fallback quantity",
    );
    return fallbackQuantity;
  }
}
