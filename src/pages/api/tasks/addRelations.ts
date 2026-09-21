import {
  addRelatedTasks,
  isTaskRelationType,
} from "@/utils/controllers/tasks/addRelatedTasks";
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const { relations } = req.body;
      if (!relations) {
        return res.status(200).json("Missing Required Data");
      }
      const invalidRelationType = relations.relatedTasks?.some(
        (related: any) =>
          related.relationType !== undefined &&
          !isTaskRelationType(related.relationType)
      );
      if (invalidRelationType) {
        return res.status(400).json({ message: "Invalid relation type" });
      }

      const currentUser = req.cookies.nookies_user
        ? JSON.parse(req.cookies.nookies_user)
        : null;
      if (!currentUser?.id) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const response = await addRelatedTasks(relations, currentUser.id);

      if (response.status === 200) {
        const currentTask = await prisma.task.findUnique({
          where: { id: parseInt(relations.currentTaskId) },
          select: { projectId: true },
        });
        const projectIds = new Set<number>();
        if (currentTask) projectIds.add(currentTask.projectId);
        (response.json as any[])?.forEach((relation) => {
          if (relation.targetTask?.projectId) projectIds.add(relation.targetTask.projectId);
        });
        projectIds.forEach((projectId) => void broadcastBoardChange(projectId));
      }

      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(200).json(undefined);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
