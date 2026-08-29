import prisma from "@/lib/prisma";
import { broadcastInboxChange } from "@/lib/realtime/server";

/**
 * Tell every user holding a notification for this task that their inbox changed.
 *
 * Deleting or archiving a task takes its rows out of the inbox, but nothing told
 * the open inboxes, so the stale row sat there until a reload (HTPR-4724). Call
 * this AFTER the task change; for a delete, the rows are gone by then, so pass
 * the user ids collected beforehand.
 */
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
