import { permanentlyDeleteTask } from "@/utils/controllers/tasks/invokeTaskDelete";
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method === "DELETE") {
      const { taskId } = req.query;
      const parsedTaskId = Number(taskId);
      if (!Number.isInteger(parsedTaskId) || parsedTaskId < 0)
        return res
          .status(400)
          .json({ message: "Missing required information" });
      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>),
      );
      if (!session) return res.status(401).json({ message: "Unauthorized" });
      // Capture the board before the row is gone so we can refresh it for everyone.
      const deletedTask = await prisma.task.findFirst({
        where: {
          id: parsedTaskId,
          status: "Deleted",
          project: taskWriteAccessWhere(session.userId),
        },
        select: { projectId: true },
      });
      if (!deletedTask)
        return res
          .status(404)
          .json({ message: "Task not found or access denied" });
      const invokeDelete = await permanentlyDeleteTask(
        parsedTaskId,
        session.userId,
      );

      if (invokeDelete === "success") {
        void broadcastBoardChange(deletedTask?.projectId);
        return res.status(200).json({ message: "Success" });
      }
      return res
        .status(409)
        .json({ message: "Task is being restored or permanently deleted" });
    }
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.log(error);
    return res.status(500).json(error);
  }
}
