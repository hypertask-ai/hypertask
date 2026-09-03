import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const projectId = Number(req.query.projectId);
    if (!Number.isInteger(projectId) || projectId < 1) {
      return res.status(400).json({ message: "Missing required information" });
    }
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>),
    );
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const ownerMembers = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: "Normal",
        ...getProjectWhere(session.userId),
      },
      include: {
        owner: true,
        members: {
          where: { agentId: null },
          include: { user: true },
        },
        ai_custom_instructions: true,
      },
    });
    if (!ownerMembers) {
      return res.status(404).json({ message: "Board not found" });
    }

    const boardAgentMembers = await prisma.member.findMany({
      where: {
        projectId,
        agentId: { not: null },
        agent: {
          revokedAt: null,
          archivedAt: null,
          ...boardAgentVisibilityWhere(session.userId),
        },
      },
      include: { agent: { select: publicAgentSelect } },
    });

    return res.status(200).json({
      ...ownerMembers,
      boardAgents: boardAgentMembers.flatMap((member) =>
        member.agent ? [member.agent] : [],
      ),
    });
  } catch (error) {
    console.error("getAllForAssignees failed", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
