import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { taskReadQuery } from "@/lib/api/task-writes/read-query";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const { notificationId, taskId, seen } = body;
    if (!notificationId && !taskId && !seen) {
      return NextResponse.json({ message: "Notification id and type are required" }, { status: 400 });
    }
    // if user wants to mark unread by taskid.
    if (taskId) {
      const parsedTaskId = parseInt(taskId as string)
      if (!Number.isInteger(parsedTaskId)) {
        return NextResponse.json({ message: "Notification id and type are required" }, { status: 400 });
      }
      // get latest notification from that tsak
      const notification_ = await prisma.notification.findFirst({
        where: {
          taskId: parsedTaskId,
          userId: session.userId,
          status: "Normal"
        },
        orderBy: {
          createdAt: "desc"
        }
      })
      if (!notification_) {
        return NextResponse.json({ message: "Notification not found" }, { status: 404 });
      }
      const updatedNotification = await prisma.notification.update({
        where: {
          id: notification_.id,

        },
        data: {
          seen: !notification_.seen
        },

      })
      return NextResponse.json(updatedNotification, { status: 200 });

    }
    // if by notification id
    else {
      const parsedNotificationId = parseInt(notificationId as string)
      if (!Number.isInteger(parsedNotificationId)) {
        return NextResponse.json({ message: "Notification id and type are required" }, { status: 400 });
      }
      const owned = await prisma.notification.findFirst({
        where: { id: parsedNotificationId, userId: session.userId },
        select: { id: true },
      })
      if (!owned) return NextResponse.json({ message: "Notification not found" }, { status: 404 });
      const updatedNotification = await prisma.notification.update({
        where: {
          id: parsedNotificationId,
        },
        data: {
          seen: seen === "1" ? false : true
        },

      })

      return NextResponse.json(updatedNotification, { status: 200 });
    }
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
