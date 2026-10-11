import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import prisma from "@/lib/prisma";
import { broadcastInboxChange, socketIdFromHeader } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { HTPR_6989_BULK_ARCHIVE_UNDO_FLAG, isFeatureEnabled } from "@/lib/flags";
import type { Status } from "@prisma/client";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session, request) => {
    // HTPR-4772: bulk notification writes belong to the signed user only.

    const { notificationIds, status } = body;
    const archiveStatus: Status = status ?? "Archive"
    if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json({ message: "Array of {notificationId, taskId, userId} objects is required" }, { status: 400 });
    }

    // taskId is optional: task-less notifications (e.g. moved/deleted-task notifications)
    // must still be archivable by their own id, otherwise they stay stuck in the inbox.
    const validEntries = notificationIds.filter(({ notificationId }) =>
      notificationId
    );

    if (validEntries.length === 0) {
      return NextResponse.json({ message: "No valid notification entries found" }, { status: 400 });
    }

    const otherUsersNotification = await prisma.notification.findFirst({
      where: {
        id: { in: validEntries.map(({ notificationId }) => notificationId) },
        userId: { not: session.userId },
      },
      select: { id: true },
    });
    if (otherUsersNotification) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const restoreInbox = archiveStatus === "Normal" &&
      await isFeatureEnabled(HTPR_6989_BULK_ARCHIVE_UNDO_FLAG, session.userId);

    const result = await prisma.$transaction(async (tx) => {
      const operations = validEntries.map(({ notificationId, taskId }) => {
        // HTPR-5640: one batch timestamp shared by the representative and its
        // siblings, so a later undo (status Normal) can restore exactly what
        // this archive action hid.
        const archivedAt = restoreInbox ? null : new Date();
        const ops = [
          tx.notification.updateMany({
            where: {
              id: notificationId,
              userId: session.userId,
              status: { not: "Deleted" },
            },
            data: {
              status: archiveStatus,
              archivedAt,
            },
          }),
        ];
        // Only clean up sibling notifications for the same task when there is a task,
        // and only when archiving. On unarchive (status Normal) a sibling write would
        // re-delete what an earlier archive just hid, and archiving them here would
        // undo the restore. Siblings are archived with the batch timestamp, never
        // Deleted, so undo stays lossless (HTPR-5640).
        if (taskId && archiveStatus !== "Normal") {
          ops.push(
            tx.notification.updateMany({
              where: {
                taskId,
                userId: session.userId,
                id: { not: notificationId },
                status: { not: "Deleted" },
              },
              data: {
                status: "Archive",
                archivedAt,
              },
            })
          );
        }
        return Promise.all(ops);
      });

      const results = await Promise.all(operations);

      const totalArchived = results.reduce((sum, [archived]) => sum + archived.count, 0);
      const totalDeleted = results.reduce((sum, [, deleted]) => sum + (deleted?.count ?? 0), 0);

      return { totalArchived, totalDeleted };
    });

    // Acting tab's socket id — excluded from the broadcast so it doesn't refetch itself (HTPR-3998).
    const excludeSocketId = socketIdFromHeader(request.rawHeaders ? request.rawHeaders["x-socket-id"] : request.headers.get("x-socket-id"));
    void broadcastInboxChange(
      session.userId,
      { originUserId: session.userId },
      excludeSocketId
    );

    return NextResponse.json({
      message: "Notifications processed successfully",
      archivedCount: result.totalArchived,
      deletedCount: result.totalDeleted,
    }, { status: 200 });
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    return await route({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
};
