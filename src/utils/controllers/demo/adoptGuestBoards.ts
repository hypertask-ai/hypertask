import { enqueueBoardCreated, processAnalyticsIntentSoon } from "@/lib/telemetry/savedWork";
import { Status } from "@prisma/client";

import { verifySession } from "@/lib/auth/session";
import { isSessionTokenRevoked } from "@/lib/auth/sessionRevocation";
import { GUEST_UID_PREFIX } from "@/lib/demo/guest";
import prisma from "@/lib/prisma";

export const ADOPTED_GUEST_UID_PREFIX = "exguest_";

export function shouldAdoptGuest(
  guest: { id: number; uid?: string | null } | null | undefined,
  targetUserId: number,
): boolean {
  if (!guest || !Number.isFinite(targetUserId)) return false;
  if (!guest.uid?.startsWith(GUEST_UID_PREFIX)) return false;
  return guest.id !== targetUserId;
}

export async function adoptGuestBoards(
  previousSessionToken: string | undefined | null,
  targetUserId: number,
): Promise<number> {
  try {
    const previousSession = verifySession(previousSessionToken ?? undefined);
    if (!previousSession || await isSessionTokenRevoked(previousSessionToken ?? undefined, { failClosed: true })) return 0;

    const guest = await prisma.user.findUnique({
      where: { id: previousSession.id },
      select: { id: true, uid: true },
    });
    if (!guest?.uid || !shouldAdoptGuest(guest, targetUserId)) return 0;
    const { id: guestId, uid: guestUid } = guest;

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { accountId: true },
    });
    if (!target?.accountId) return 0;

    const [ownedBoards, memberships] = await Promise.all([
      prisma.project.count({
        where: { ownerId: targetUserId, status: Status.Normal },
      }),
      prisma.member.count({ where: { userId: targetUserId } }),
    ]);
    if (ownedBoards > 0 || memberships > 0) return 0;

    const projects = await prisma.project.findMany({
      where: { ownerId: guestId, status: Status.Normal },
      select: { id: true },
    });
    if (projects.length === 0) return 0;
    const projectIds = projects.map((project) => project.id);

    const accountId = target.accountId;
    const analyticsKeys = await prisma.$transaction(async (tx) => {
      await tx.team.updateMany({
        where: { googleAccount: { userId: guestId } },
        data: { googleAccountId: accountId },
      });
      await tx.project.updateMany({
        where: { id: { in: projectIds } },
        data: { ownerId: targetUserId, googleAccountId: accountId, seeded: true },
      });

      await tx.member.deleteMany({
        where: { projectId: { in: projectIds }, userId: targetUserId },
      });
      await tx.member.updateMany({
        where: { projectId: { in: projectIds }, userId: guestId },
        data: { userId: targetUserId },
      });
      await tx.member_Team.updateMany({
        where: { userId: guestId },
        data: { userId: targetUserId, googleAccountId: accountId },
      });

      await tx.assignees.updateMany({
        where: {
          task: { projectId: { in: projectIds } },
          userId: guestId,
        },
        data: { userId: targetUserId },
      });
      await tx.assignees.updateMany({
        where: {
          task: { projectId: { in: projectIds } },
          assignerId: guestId,
        },
        data: { assignerId: targetUserId },
      });

      await tx.user.update({
        where: { id: guestId },
        data: {
          uid: guestUid.replace(GUEST_UID_PREFIX, ADOPTED_GUEST_UID_PREFIX),
        },
      });
      const keys: string[] = [];
      for (const projectId of projectIds) {
        keys.push(await enqueueBoardCreated(tx, projectId, "adopted_demo", { userId: targetUserId }));
      }
      return keys;
    });

    for (const key of analyticsKeys) processAnalyticsIntentSoon(key);
    return projectIds.length;
  } catch (error) {
    console.error("Guest board adoption failed (non-fatal):", error);
    return 0;
  }
}
