export const STRAIGHT_BOARD_UID_PREFIX = "email_sb_";

export async function unverifiedEmailAccount(userId: number) {
  try {
    const user = await (await import("@/lib/prisma")).default.user.findUnique({
      where: { id: userId }, select: { uid: true, emailVerified: true, UserSetting: { select: { isVerified: true } } } });
    if (!user?.uid?.startsWith(STRAIGHT_BOARD_UID_PREFIX)) return "allowed";
    return user.emailVerified || user.UserSetting?.isVerified ? "allowed" : "blocked";
  } catch {
    return "unknown";
  }
}
