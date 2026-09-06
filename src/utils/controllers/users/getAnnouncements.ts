import prisma from "@/lib/prisma";

export const getUserAnnouncements = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return null;

  const missing = await prisma.announcments.findMany({
    where: {
      isActive: true,
      userAnnouncements: { none: { userId } },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
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
    where: { userId },
    include: { announcement: true },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
};
