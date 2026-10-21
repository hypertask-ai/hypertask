import prisma from "@/lib/prisma";
import { broadcastInboxChange } from "@/lib/realtime/server";

export async function broadcastInboxForTask(
  taskId: number,
  userIds?: number[]
): Promise<void> {
  const ids =
    userIds ??
    (
      await prisma.notification.findMany({
        where: { taskId },
        select: { userId: true },
        distinct: ["userId"],
      })
    ).map((row) => row.userId);

  await Promise.all(
    Array.from(new Set(ids)).map((userId) => broadcastInboxChange(userId))
  );
}
