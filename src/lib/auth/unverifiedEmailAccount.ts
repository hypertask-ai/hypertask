import prisma from "@/lib/prisma";

export const STRAIGHT_BOARD_UID_PREFIX = "email_sb_";

type AccountVerification = {
  uid?: string | null;
  emailVerified?: boolean | null;
  UserSetting?: { isVerified?: boolean | null } | null;
};

export function isUnverifiedStraightBoardAccount(user: AccountVerification | null | undefined) {
  if (!user?.uid?.startsWith(STRAIGHT_BOARD_UID_PREFIX)) return false;
  return !user.emailVerified && !user.UserSetting?.isVerified;
}

export async function unverifiedEmailAccount(userId: number) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { uid: true, emailVerified: true, UserSetting: { select: { isVerified: true } } },
    });
    return isUnverifiedStraightBoardAccount(user) ? "blocked" : "allowed";
  } catch {
    return "unknown";
  }
}

export async function accountNotificationsBlocked(userId: number) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { uid: true, emailVerified: true, UserSetting: { select: { isVerified: true } } },
    });
    return isUnverifiedStraightBoardAccount(user);
  } catch {
    return false;
  }
}
