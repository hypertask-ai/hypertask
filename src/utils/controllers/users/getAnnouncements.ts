import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_9064_LATEST_UPDATES_WEEK_FLAG } from "@/lib/flags/definitions/htpr-9064-latest-updates-week";
import { LATEST_UPDATES_REACH_DAYS } from "@/lib/rocketDigest/panel";

const ANNOUNCEMENT_LIMIT = 15;
const REACH_MS = LATEST_UPDATES_REACH_DAYS * 24 * 60 * 60 * 1000;

export const getUserAnnouncements = async (
  userId: number,
  { now = new Date(), flagEnabled = isFeatureEnabled }: {
    now?: Date;
    flagEnabled?: (key: string, userId: number) => Promise<boolean>;
  } = {},
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return null;

  const weekOfUpdates = await flagEnabled(HTPR_9064_LATEST_UPDATES_WEEK_FLAG, userId).catch(() => false);
  const since = new Date(now.getTime() - REACH_MS);

  const missing = await prisma.announcments.findMany({
    where: {
      isActive: true,
      ...(weekOfUpdates ? { createdAt: { gte: since } } : {}),
      userAnnouncements: { none: { userId } },
    },
    orderBy: { createdAt: "desc" },
    ...(weekOfUpdates ? {} : { take: ANNOUNCEMENT_LIMIT }),
    select: { id: true },
  });
  if (missing.length) {
    await prisma.userAnnouncement.createMany({
      data: missing.map((announcement) => ({
        userId,
        announcementId: announcement.id,
      })),
      skipDuplicates: true,
    });
  }

  return prisma.userAnnouncement.findMany({
    where: {
      userId,
      ...(weekOfUpdates ? { announcement: { createdAt: { gte: since } } } : {}),
    },
    include: { announcement: true },
    orderBy: { announcement: { createdAt: "desc" } },
    ...(weekOfUpdates ? {} : { take: ANNOUNCEMENT_LIMIT }),
  });
};
