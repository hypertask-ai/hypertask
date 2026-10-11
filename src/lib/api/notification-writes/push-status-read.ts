import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { taskReadQuery } from "@/lib/api/task-writes/read-query";
import { notificationWriteJson } from "./response";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const getRoute = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const userId = session.userId;
    const { firebaseId } = body;

    if (!firebaseId) return notificationWriteJson({message:"Missing UserId"}, 304)

    const deviceStatus = await prisma.subscribedDevices.findFirst({
        where:{
            firebaseId:firebaseId as string,
            userId
        }
    })

    return notificationWriteJson(deviceStatus, 200);
  },
});

export const GET: TaskWriteRoute = async (request, authenticatedSession) => {
  const session = authenticatedSession ?? await getSessionUser(request.headers);
  if (!session) return notificationWriteJson({ message: "Unauthorized" }, 401);
  try {
    const body = taskReadQuery(request);
    return await getRoute({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.error(error);
    return notificationWriteJson({ message: "Internal server error" }, 500);
  }
};
