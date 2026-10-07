import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { notificationWriteJson } from "./response";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const postRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const { firebaseId, newStatus } = body;
    if (!firebaseId ) return notificationWriteJson({message:"Missing Required Data"}, 304)
    console.log("🚀 ~ file: changePushNotificationStatus.ts:11 ~ consthandler:NextApiHandler= ~ firebaseId:", firebaseId)

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
    // console.log("🚀 ~ file: changePushNotificationStatus.ts:20 ~ consthandler:NextApiHandler= ~ deviceStatus:", deviceStatus)

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
