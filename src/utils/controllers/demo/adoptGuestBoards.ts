import { Status } from "@prisma/client";

import { verifySession } from "@/lib/auth/session";
import { GUEST_UID_PREFIX } from "@/lib/demo/guest";
import prisma from "@/lib/prisma";

// A guest whose work has been claimed is no longer a throwaway row: the TTL cron
// (findStaleGuestIds -> deleteGuestCascade in src/lib/demo/cleanupGuest.ts) selects
// on this prefix and deletes every task/comment the user authored, which would gut
// the very board we just handed over. Re-prefixing takes them out of that query,
// and deleteGuestCascade's own guard then refuses them a second time.
export const ADOPTED_GUEST_UID_PREFIX = "exguest_";

/**
 * HTPR-4893: only a real, still-anonymous guest hands their boards over, and never
 * to themselves (the demo route mints a Better Auth session for the guest, which
 * runs the same adoption hook with guest === target).
 */
export function shouldAdoptGuest(
  guest: { id: number; uid?: string | null } | null | undefined,
  targetUserId: number,
): boolean {
  if (!guest || !Number.isFinite(targetUserId)) return false;
  if (!guest.uid?.startsWith(GUEST_UID_PREFIX)) return false;
  return guest.id !== targetUserId;
}

/**
 * Moves an anonymous guest's boards to the account that just signed in, so the work
 * they did on /demo survives sign-up. Call it from every auth chokepoint that can
 * run in a browser still carrying a guest session, BEFORE the new cookies are set.
 *
 * The guest's whole workspace moves, not just the project row: a freshly created
 * user has a GoogleAccount but no Team (provisionNewUser stops at the account), so
 * re-parenting the guest's team under their account is what makes the board show up
 * on their board list. Ownership of the guest User row itself is left alone.
 *
 * Never throws: a failed adoption must not fail the sign-in. Returns how many
 * boards moved.
 */
export async function adoptGuestBoards(
  previousSessionToken: string | undefined | null,
  targetUserId: number,
): Promise<number> {
  try {
    const previousSession = verifySession(previousSessionToken ?? undefined);
    if (!previousSession) return 0;

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
    // No GoogleAccount means nothing to re-parent the workspace under. Skip rather
    // than invent one: the guest rows stay put and the TTL cron still owns them.
    if (!target?.accountId) return 0;

    // HTPR-5001: demo boards only follow into a brand-new, empty account. An
    // account that already owns or belongs to any board gets nothing; adopted
    // demo boards just pile up there as worthless "My Board" copies. The
    // skipped guest rows stay on the guest user and the TTL cron removes them.
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
    await prisma.$transaction(async (tx) => {
      await tx.team.updateMany({
        where: { googleAccount: { userId: guestId } },
        data: { googleAccountId: accountId },
      });
      await tx.project.updateMany({
        where: { id: { in: projectIds } },
        data: { ownerId: targetUserId, googleAccountId: accountId },
      });

      // Repoint the guest's own membership rows instead of adding new ones, so the
      // new owner inherits the Admin/Accepted rows the demo provisioner created and
      // no project ends up with two rows for the same person.
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

      // Guest demo tasks can be assigned to their anonymous owner. Carry both
      // sides of those assignment rows to the signed-up account so My Tasks keeps
      // working and no assignment points at the retained exguest identity.
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
    });

    return projectIds.length;
  } catch (error) {
    console.error("Guest board adoption failed (non-fatal):", error);
    return 0;
  }
}
