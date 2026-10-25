import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import prisma from "@/lib/prisma";
import { broadcastInboxChange, socketIdFromHeader } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import type { Status } from "@prisma/client";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7953_INBOX_BULK_ARCHIVE_FLAG } from "@/lib/flags/definitions/htpr-7953-inbox-bulk-archive";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session, request) => {
    const { notificationIds, status } = body;
    const archiveStatus: Status = status ?? "Archive"
    if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json({ message: "Array of {notificationId, taskId, userId} objects is required" }, { status: 400 });
    }

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

    const restoreInbox = archiveStatus === "Normal";
    const batchArchive = await isFeatureEnabled(HTPR_7953_INBOX_BULK_ARCHIVE_FLAG, session.userId);

    const result = await prisma.$transaction(async (tx) => {
      if (batchArchive) {
        const notificationIds = validEntries.map(({ notificationId }) => notificationId);
        const taskIds = validEntries.filter(({ taskId }) => taskId).map(({ taskId }) => taskId);
        const archivedAt = restoreInbox ? null : new Date();
        const archived = await tx.notification.updateMany({
          where: { id: { in: notificationIds }, userId: session.userId, status: { not: "Deleted" } },
          data: { status: archiveStatus, archivedAt },
        });
        const siblings = !restoreInbox && taskIds.length > 0
          ? await tx.notification.updateMany({
            where: { taskId: { in: taskIds }, id: { notIn: notificationIds }, userId: session.userId, status: { not: "Deleted" } },
            data: { status: "Archive", archivedAt },
          })
          : { count: 0 };
        return { totalArchived: archived.count, totalDeleted: siblings.count };
      }
      const operations = validEntries.map(({ notificationId, taskId }) => {
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
