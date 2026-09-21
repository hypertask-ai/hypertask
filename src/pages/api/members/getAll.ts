import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import membersGetAll from "@/utils/controllers/members/getAll";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse,
) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { projectId, teamMembers, teamId } = req.query;
    const parsedProjectId = Number(projectId);
    if (!Number.isInteger(parsedProjectId) || parsedProjectId < 1) {
      return res.status(200).json([]);
    }
    const userId = (
      await getSessionUser(new Headers(req.headers as Record<string, string>))
    )?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const board = await prisma.project.findFirst({
      where: {
        id: parsedProjectId,
        status: "Normal",
        ...getProjectWhere(userId),
      },
      select: { id: true },
    });
    if (!board) return res.status(404).json({ message: "Board not found" });

    const response = await membersGetAll(
      String(parsedProjectId),
      { id: userId },
      teamMembers,
      teamId,
    );
    return res.status(response.status).json(response.json);
  } catch (error) {
    console.error("GET /api/members/getAll failed", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
