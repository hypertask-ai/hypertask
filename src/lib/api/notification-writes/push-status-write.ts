import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { notificationWriteJson } from "./response";
import prisma from "@/lib/prisma";
import { logPersonal } from "@/utils/controllers/logs/quietPersonalLog";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const postRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const { firebaseId, newStatus } = body;
    if (!firebaseId ) return notificationWriteJson({message:"Missing Required Data"}, 304)
    const ownedDevice = await prisma.subscribedDevices.findFirst({
        where: { firebaseId, userId: session.userId },
        select: { id: true },
    })
    await logPersonal(session.userId, "push status", {
        userId: session.userId,
        deviceId: ownedDevice?.id ?? null,
        outcome: "update",
    }, { firebaseId })

    const deviceStatus = await prisma.subscribedDevices.updateMany({
        where:{
            firebaseId:firebaseId,
            userId: session.userId,
        },
        data:{
            sendNotifications:newStatus
        }
    })
    if (deviceStatus.count === 0) {
        return notificationWriteJson({ message: "Device not found" }, 404);
    }

    return notificationWriteJson({message:"success"}, 200);
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return notificationWriteJson({ message: "Unauthorized" }, 401);
    const body = await request.json();
    return await postRoute({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.error(error);
    return notificationWriteJson({ message: "Internal server error" }, 500);
  }
};
