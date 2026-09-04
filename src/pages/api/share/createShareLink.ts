import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { TaskShareType } from "@prisma/client";
import { redactAgentIdentitiesForPublicShare } from "@/lib/agents/publicAgent";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const { userId, taskId, projectId } = req.body;
    try {
      if (!userId || !taskId || !projectId) {
        return res
          .status(400)
          .json({ message: "Missing required information" });
      }

      const currentProject = await prisma.project.findFirst({
        where: {
          id: parseInt(projectId),
          status: "Normal",
        },
      });
      if (!currentProject)
        throw "The project doesn't seem to exist, or params were incorrect";

      //first things first we are going to find if any links exist for this task by the current user
      const foundLink = await prisma.taskSharing.findMany({
        where: {
          userId: userId,
          taskId: taskId,
          projectId: projectId,
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
            taskId,
            userId,
            projectId,
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
      prisma.taskSharing.deleteMany({
        where: { projectId, taskId, userId },
      });
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

      const taskShareFound = await prisma.taskSharing.findUnique({
        where: {
          id: shareId,
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
          .status(400)
          .json({ message: "Task share link does not exist" });
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else if (req.method === "GET") {
    const { shareId } = req.query;

    try {
      const taskShared = await prisma.taskSharing.findUnique({
        where: {
          id: shareId as string,
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
