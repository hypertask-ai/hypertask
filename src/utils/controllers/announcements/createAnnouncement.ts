import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  ANNOUNCEMENT_USER_BATCH_SIZE,
  WELCOME_USER_IDS,
  announcementIsWelcome,
} from "@/lib/announcements/fanout";

async function fanOutToEveryUser(announcementId: number, batchSize: number) {
  const results: unknown[] = [];
  let offset = 0;
  let batch: { id: number }[] = [];

  do {
    batch = await prisma.user.findMany({
      skip: offset,
      take: batchSize,
      select: { id: true },
    });
    if (batch.length > 0) {
      results.push(
        await prisma.userAnnouncement.createMany({
          data: batch.map((user) => ({ userId: user.id, announcementId })),
        }),
      );
    }
    offset += batchSize;
  } while (batch.length === batchSize);

  return results;
}

export async function createAnnouncement({
  body,
  createdAt,
  batchSize = ANNOUNCEMENT_USER_BATCH_SIZE,
}: {
  body: unknown;
  createdAt?: Date;
  batchSize?: number;
}) {
  const isWelcome = announcementIsWelcome(body);
  const announcement = await prisma.announcments.create({
    data: {
      body: (body ?? {}) as Prisma.InputJsonValue,
      isWelcome,
      ...(createdAt ? { createdAt } : {}),
    },
  });

  const userAnnouncements = isWelcome
    ? [
        await prisma.userAnnouncement.createMany({
          data: WELCOME_USER_IDS.map((userId) => ({
            userId,
            announcementId: announcement.id,
          })),
        }),
      ]
    : await fanOutToEveryUser(announcement.id, batchSize);

  return { announcement, user_announcements: userAnnouncements };
}
