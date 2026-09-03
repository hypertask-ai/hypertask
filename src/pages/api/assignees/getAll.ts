import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import assigneesGetAll from "@/utils/controllers/assignees/getAll";
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
    const taskId = Number(req.query.taskId);
    if (!Number.isInteger(taskId) || taskId < 1) {
      return res.status(400).json({ message: "Missing Task Id" });
    }
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>),
    );
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        status: { not: "Deleted" },
        project: getProjectWhere(session.userId),
      },
      select: { id: true },
    });
    if (!task) return res.status(404).json({ message: "Task not found" });

    const response = await assigneesGetAll(String(taskId), session.userId);
    return res.status(response.status).json(response.json);
  } catch (error) {
    console.error("GET /api/assignees/getAll failed", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
