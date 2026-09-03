import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const { projectId } = req.query;
      if (!projectId) {
        return res.status(400).json({ message: "Missing required information" });
      }

      const owner_members = await prisma.project.findFirst({
        where: {
          id: parseInt(projectId as string),
          status: "Normal",
        },
        include: {
          owner: true,
          members: {
            where: { agentId: null },
            include: {
              user: true,
            },
          },
          ai_custom_instructions: true,
        },
      });

      const boardAgentMembers = await prisma.member.findMany({
        where: {
          projectId: parseInt(projectId as string),
          agentId: { not: null },
          agent: { revokedAt: null, archivedAt: null },
        },
        include: {
          agent: { select: publicAgentSelect },
        },
      });

      const boardAgents = boardAgentMembers
        .filter((m) => m.agent != null)
        .map((m) => m.agent!);

      return res.status(200).json({
        ...owner_members,
        boardAgents,
      });
    } catch (error) {
      console.log(error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
