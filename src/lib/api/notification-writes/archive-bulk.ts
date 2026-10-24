import { BoardAccessError, mutateBoardAccessNotification } from "@/lib/agents/boardAccessRequests/service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import prisma from "@/lib/prisma";
import { broadcastInboxChange, socketIdFromHeader } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import type { Status } from "@prisma/client";

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

    const accessIds = new Set<number>();
    for (const entry of validEntries) {
      const candidate = await prisma.notification.findUnique({ where: { id: Number(entry.notificationId) }, select: { type: true } });
      if (candidate?.type !== "AgentBoardAccessRequest") continue;
      if (archiveStatus !== "Normal" && archiveStatus !== "Archive") return NextResponse.json({ message: "Invalid status" }, { status: 400 });
      if (session.agentId || session.source === "cli-bearer" || entry.taskId != null) return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      accessIds.add(Number(entry.notificationId));
    }
    for (const id of accessIds) {
      try {
        await mutateBoardAccessNotification(session, id, null, { status: archiveStatus as "Normal" | "Archive" });
      } catch (error) {
        if (!(error instanceof BoardAccessError)) throw error;
        return NextResponse.json({ message: error.message }, { status: error.status });
      }
    }
    const restoreInbox = archiveStatus === "Normal";

    const taskEntries = validEntries.filter(({ notificationId }) => !accessIds.has(Number(notificationId)));
    const notificationIdList = taskEntries.map(({ notificationId }) => notificationId);
    const taskIds = [...new Set(taskEntries.map(({ taskId }) => taskId).filter(Boolean))];
    const archivedAt = restoreInbox ? null : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const archived = await tx.notification.updateMany({
        where: {
          id: { in: notificationIdList },
          userId: session.userId,
          status: { not: "Deleted" },
        },
        data: {
          status: archiveStatus,
          archivedAt,
        },
      });
      const siblings = !restoreInbox && taskIds.length > 0
        ? await tx.notification.updateMany({
          where: {
            taskId: { in: taskIds },
            userId: session.userId,
            id: { notIn: notificationIdList },
            status: { not: "Deleted" },
          },
          data: {
            status: "Archive",
            archivedAt,
          },
        })
        : null;

      return { totalArchived: archived.count, totalDeleted: siblings?.count ?? 0 };
    });

    const excludeSocketId = socketIdFromHeader(request.rawHeaders ? request.rawHeaders["x-socket-id"] : request.headers.get("x-socket-id"));
    void broadcastInboxChange(
      session.userId,
      { originUserId: session.userId },
      excludeSocketId
    );

    return NextResponse.json({
      message: "Notifications processed successfully",
      archivedCount: result.totalArchived + accessIds.size,
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
