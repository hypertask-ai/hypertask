import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { TaskShareType } from "@prisma/client";
import { redactAgentIdentitiesForPublicShare } from "@/lib/agents/publicAgent";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== "POST" && req.method !== "PUT" && req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>),
  );
  if (!session) return res.status(401).json({ message: "Unauthorized" });

  if (req.method === "POST") {
    const { userId: bodyUserId, taskId, projectId } = req.body;
    const parsedTaskId = Number(taskId);
    const parsedProjectId = Number(projectId);
    try {
      if (bodyUserId != null && Number(bodyUserId) !== session.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (!Number.isInteger(parsedTaskId) || !Number.isInteger(parsedProjectId)) {
        return res
          .status(400)
          .json({ message: "Missing required information" });
      }

      const currentProject = await prisma.project.findFirst({
        where: {
          id: parsedProjectId,
          status: "Normal",
          ...taskWriteAccessWhere(session.userId),
        },
      });
      if (!currentProject)
        return res.status(404).json({ message: "Task not found or access denied" });

      const task = await prisma.task.findFirst({
        where: {
          id: parsedTaskId,
          projectId: parsedProjectId,
          project: taskWriteAccessWhere(session.userId),
        },
        select: { id: true },
      });
      if (!task)
        return res.status(404).json({ message: "Task not found or access denied" });

      const userId = session.userId;
      //first things first we are going to find if any links exist for this task by the current user
      const foundLink = await prisma.taskSharing.findMany({
        where: {
          userId: userId,
          taskId: parsedTaskId,
          projectId: parsedProjectId,
        },
      });

      let linkObj: { type: TaskShareType; link: string; id: string };

      if (foundLink && foundLink.length > 0) {
        linkObj = {
          link: generateShareLink(foundLink[0].id),
          type: foundLink[0].shareType,
          id: foundLink[0].id,
        };

        return res.status(200).json({
          message: JSON.stringify("Old Link Found"),
          data: linkObj,
        });
      } else {
        const defaultLink = await prisma.taskSharing.create({
          data: {
            taskId: parsedTaskId,
            userId,
            projectId: parsedProjectId,
          },
        });

        linkObj = {
          link: generateShareLink(defaultLink.id),
          type: defaultLink.shareType,
          id: defaultLink.id,
        };

        return res.status(200).json({
          message: JSON.stringify("New Link Generated"),
          data: linkObj,
        });
      }
    } catch (error) {
      console.log("🚀 ~ error:", error);
      if (Number.isInteger(parsedTaskId) && Number.isInteger(parsedProjectId)) {
        prisma.taskSharing.deleteMany({
          where: { projectId: parsedProjectId, taskId: parsedTaskId, userId: session.userId },
        });
      }
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else if (req.method === "PUT") {
    const { shareId, newType } = req.body;
    try {
      if (!shareId || !newType) {
        return res
          .status(400)
          .json({ message: "Missing required information" });
      }

      const taskShareFound = await prisma.taskSharing.findFirst({
        where: {
          id: shareId,
          task: { project: taskWriteAccessWhere(session.userId) },
        },
      });

      if (taskShareFound) {
        await prisma.taskSharing.update({
          where: {
            id: shareId,
          },
          data: {
            shareType: newType,
          },
        });

        return res.status(200).json({ message: "Task share link updated" });
      } else
        return res
          .status(404)
          .json({ message: "Task share link does not exist" });
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else if (req.method === "GET") {
    const { shareId } = req.query;

    try {
      const taskShared = await prisma.taskSharing.findFirst({
        where: {
          id: shareId as string,
          task: { project: taskWriteAccessWhere(session.userId) },
        },
        include: {
          task: true,
        },
      });

      if (taskShared)
        return res.status(200).json({
          taskShared: redactAgentIdentitiesForPublicShare(taskShared),
        });
      else return res.status(201).json({});
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export const generateShareLink = (shareId: string) => {
  const baseURL = String(process.env.NEXT_PUBLIC_BASEURL);
  return `${baseURL}/share?id=${shareId}`;
};

export default handler;
