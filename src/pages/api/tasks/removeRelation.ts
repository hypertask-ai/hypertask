import { removeRelatedTask } from "@/utils/controllers/tasks/removeRelatedTask";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { relationId } = req.body;
      if (!relationId) {
        return res.status(200).json("Missing Required Data");
      }

      const relation = await prisma.taskRelations.findFirst({
        where: {
          id: Number(relationId),
          sourceTask: { project: getProjectWhere(session.userId) },
          targetTask: { project: getProjectWhere(session.userId) },
        },
        select: {
          sourceTask: { select: { projectId: true } },
          targetTask: { select: { projectId: true } },
        },
      });
      if (!relation) {
        return res.status(404).json({ message: "Relation not found" });
      }

      const response = await removeRelatedTask(relationId);

      if (response.status === 200) {
        Array.from(new Set([
          relation?.sourceTask.projectId,
          relation?.targetTask.projectId,
        ])).forEach((projectId) => void broadcastBoardChange(projectId));
      }

      return res.status(response.status).json(response);
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(200).json(undefined);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
