import { env as appEnv } from "#env";
import { logger as htLogger } from "#logger";
import { withoutAuth } from "#with-auth";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { redactAgentIdentitiesForPublicShare } from "@/lib/agents/publicAgent";
import prisma from "@/lib/prisma";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
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
      else return res.status(400).json({});
    } catch (error) {
      htLogger.info("🚀 ~ error:", error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export const generateShareLink = (shareId: string) => {
  const baseURL = String(appEnv.NEXT_PUBLIC_BASEURL);
  return `${baseURL}/share?id=${shareId}`;
};

export default withoutAuth(handler);
