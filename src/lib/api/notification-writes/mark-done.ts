import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { taskReadQuery } from "@/lib/api/task-writes/read-query";
import prisma from "@/lib/prisma";
import { broadcastInboxChange, socketIdFromHeader } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session, request) => {
    // HTPR-4772: ignore the query userId and use the signed session.

    const { id, taskId, tutorial } = body;
    const userId = session.userId;
    // Acting tab's socket id — excluded from the broadcast so it doesn't refetch itself (HTPR-3998).
    const excludeSocketId = socketIdFromHeader(request.rawHeaders ? request.rawHeaders["x-socket-id"] : request.headers.get("x-socket-id"));
    // Need at least a notification id (inbox) or a taskId (task detail page) to act on.
    if (!taskId && !id) {
      return NextResponse.json({ message: "Notification id or taskId is required" }, { status: 400 });
    }
    // Some notifications legitimately have no task (moved/deleted-task notifications).
    // parsedTaskId is null in that case so we skip taskId-scoped sibling cleanup and
    // archive the notification by its own id instead.
    const parsedTaskId = Number.isInteger(Number(taskId)) ? parseInt(taskId as string) : null;

    const timeNow = new Date()

    if (tutorial === "1" && !id) {
      return NextResponse.json({
        message: "Tutorial notification id is required",
      }, { status: 400 });
    }

    // ================= archiving from [TASK DETAIL PAGE]. we dont have the id, we just want to assume we are archiving all the notifications of that task.
    if (!id) {
      if (parsedTaskId === null) {
        return NextResponse.json({ message: "taskId is required when no notification id is provided" }, { status: 400 });
      }
      const updatedCount = await prisma.notification.updateMany({
        where: {
          taskId: parsedTaskId,
          userId,
          status: { not: "Deleted" }
        },
        data: {
          status: "Archive",
          archivedAt: timeNow

        }
      })
      void broadcastInboxChange(userId, { originUserId: userId }, excludeSocketId);
      return NextResponse.json(updatedCount, { status: 200 });

    }

    // ----------------------------------------------------------------------------------------------------------------------------------
    // ================== archiving from [INBOX PAGE]
    const notification_ = await prisma.notification.findUnique({
      where: {
        id: parseInt(id as string),

      }

    })
    console.log("🚀 ~ consthandler:NextApiHandler= ~ notification_:", notification_)

    if (notification_ && notification_.userId !== userId) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    // HTPR-4877: an id that matches nothing used to reach the end of
    // the try with no response sent, so the request hung until the
    // client timed out. Answer explicitly.
    if (!notification_) {
      return NextResponse.json({ message: "Notification not found" }, { status: 404 });
    }

    if (tutorial === "1") {
      const tutorialNotification =
        notification_.projectId !== null && notification_.taskId !== null
          ? await prisma.notification.findFirst({
            where: {
              fromAgentId: null,
              fromUserId: userId,
              id: notification_.id,
              projectId: notification_.projectId,
              project: {
                ownerId: userId,
                status: "Normal",
                title: "Learn Hypertask",
              },
              returnedFromReminders: false,
              taskId: notification_.taskId,
              task: {
                projectId: notification_.projectId,
                status: "Normal",
              },
              type: "TaskMovedToInbox",
              userId,
            },
            select: { id: true },
          })
          : null;
      if (!tutorialNotification) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
      }
      if (
        notification_.status !== "Normal" ||
        notification_.archivedAt !== null
      ) {
        return NextResponse.json({ message: "Tutorial notification is not active" }, { status: 409 });
      }
      const updatedNotification = await prisma.notification.update({
        where: { id: notification_.id },
        data: { status: "Archive", archivedAt: timeNow },
      });
      void broadcastInboxChange(
        updatedNotification.userId,
        { originUserId: updatedNotification.userId },
        excludeSocketId,
      );
      return NextResponse.json(updatedNotification, { status: 200 });
    }

    // =================== archive all of that task and that userid.
    if (notification_?.status === "Normal") {
      if (notification_.type === "Invited") {
        const updatedNotification = await prisma.notification.update({ where: { id: notification_.id }, data: { status: "Archive", archivedAt: timeNow } })
        void broadcastInboxChange(updatedNotification.userId, { originUserId: updatedNotification.userId }, excludeSocketId);
        return NextResponse.json(updatedNotification, { status: 200 });

      }

      // Only clean up sibling notifications when this notification is tied to a task.
      // Task-less notifications have no siblings to group, and a NaN taskId here would throw
      // before the representative gets archived, leaving it stuck in the inbox.
      // HTPR-5640: siblings are ARCHIVED with the exact same batch timestamp instead of
      // Deleted. The undo path restores every notification sharing that timestamp, so
      // Ctrl+Z brings back what the archive removed; a hard delete made undo lossy.
      if (parsedTaskId !== null) {
        await prisma.notification.updateMany({
          where: {
            id: { not: notification_.id },
            taskId: parsedTaskId,
            userId,
            status: { not: "Deleted" }
          },
          data: {
            status: "Archive",
            archivedAt: timeNow
          }
        })
      }
      const updatedNotifiction = await prisma.notification.update({ where: { id: notification_.id }, data: { status: "Archive", archivedAt: timeNow } })
      void broadcastInboxChange(notification_.userId, { originUserId: notification_.userId }, excludeSocketId);
      return NextResponse.json(updatedNotifiction, { status: 200 });

    }

    // =================== unarchive only single.
    else if (notification_?.status === "Archive") {
      const onlySingleNotificationUpdate = await prisma.notification.update({
        where: {
          id: notification_?.id
        },
        data: {
          status: "Normal",
          archivedAt: null
        }
      })
      // HTPR-5640: bring back the siblings hidden by the same archive action.
      // They share the representative's exact batch archivedAt, so an unrelated
      // earlier archive of the same task is never touched.
      if (
        parsedTaskId !== null &&
        notification_.archivedAt !== null &&
        notification_.archivedAt !== undefined
      ) {
        await prisma.notification.updateMany({
          where: {
            id: { not: notification_.id },
            taskId: parsedTaskId,
            userId,
            status: "Archive",
            archivedAt: notification_.archivedAt
          },
          data: {
            status: "Normal",
            archivedAt: null
          }
        })
      }
      void broadcastInboxChange(onlySingleNotificationUpdate.userId, { originUserId: onlySingleNotificationUpdate.userId }, excludeSocketId);
      return NextResponse.json(onlySingleNotificationUpdate, { status: 200 });

    }

    // Any other status (today: Deleted) has nothing to toggle. Same
    // reason as the 404 above: falling out of the branches sent no
    // response at all and the request hung. HTPR-4877.
    return NextResponse.json(notification_, { status: 200 });
  },
});

export const GET: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = taskReadQuery(request);
    return await route({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.log(error);

    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
};
