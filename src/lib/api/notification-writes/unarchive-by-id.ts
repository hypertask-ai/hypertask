import { boardAccessNotificationWrite } from "./board-access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import prisma from "@/lib/prisma";
import { broadcastInboxChange, socketIdFromHeader } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session, request) => {
    const userId = session.userId;

    const { notificationId } = body;
    if (!notificationId) {
      return NextResponse.json({ message: "Missing Required Information" }, { status: 400 })
    }

    const accessResponse = await boardAccessNotificationWrite(session, notificationId, body.taskId, { status: "Normal" });
    if (accessResponse) return accessResponse;
    const { count } = await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: {
        status: "Normal",
        archivedAt: null
      }
    })
    if (count === 0) {
      return NextResponse.json({ message: "Notification not found" }, { status: 404 })
    }
    const updatedNotification = await prisma.notification.findUniqueOrThrow({
      where: { id: notificationId }
    })

    await prisma.notification.updateMany({
      where: {
        id: { not: updatedNotification.id },
        type: updatedNotification.type,
        userId: updatedNotification.userId,
        taskId: updatedNotification.taskId,
      },
      data: {
        status: "Deleted"
      }
    })
    const excludeSocketId = socketIdFromHeader(request.rawHeaders ? request.rawHeaders["x-socket-id"] : request.headers.get("x-socket-id"));
    void broadcastInboxChange(
      updatedNotification.userId,
      { originUserId: updatedNotification.userId },
      excludeSocketId
    );

    return NextResponse.json(updatedNotification, { status: 200 })
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    return await route({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.log(error)
    return NextResponse.json(error, { status: 500 })
  }
};
