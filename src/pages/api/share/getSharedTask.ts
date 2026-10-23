import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import {
  checkIfBoardMember,
  isShareLinkLive,
} from "@/utils/controllers/tasks/getSharedTask";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const { shareId } = req.query;
    if (typeof shareId !== "string" || !shareId) return res.status(400).json({});
    try {
      const taskShared = await prisma.taskSharing.findUnique({
        where: { id: shareId },
        select: {
          id: true,
          shareType: true,
          expired: true,
          expiredAt: true,
          task: { select: { projectId: true, uniqueIndex: true, status: true } },
        },
      });

      if (!taskShared || !isShareLinkLive(taskShared)) return res.status(400).json({});

      if (taskShared.shareType === "Domain") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (
          !session ||
          (await checkIfBoardMember(session.userId, taskShared.task.projectId)) !== 200
        ) {
          return res.status(403).json({});
        }
      }

      return res.status(200).json({
        taskShared: {
          id: taskShared.id,
          shareType: taskShared.shareType,
          projectId: taskShared.task.projectId,
          task: { uniqueIndex: taskShared.task.uniqueIndex },
        },
      });
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(400).json({});
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
