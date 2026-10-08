import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import SearchForOrphanTasks from "@/utils/controllers/tasks/getOrphanTasks";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "GET") {
    try {
      const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
      if (!session) return res.status(401).json({ message: "Unauthorized" });
      const { projectId, searchQuery, currentTaskId } = req.query;

      if (!projectId || !currentTaskId) {
        return res.status(200).json("Missing Required Data");
      }

      const task = await prisma.task.findFirst({
        where: { id: parseInt(currentTaskId as string), projectId: parseInt(projectId as string), project: projectContentAccessWhere(session.userId) },
        select: { id: true },
      });
      if (!task) return res.status(404).json({ message: "Task not found" });

      const response = await SearchForOrphanTasks(
        parseInt(projectId as string),
        parseInt(currentTaskId as string),
        searchQuery as string
      );

      return res.status(response.status).json(response);
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return res.status(200).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default withTaskWriteFlag(handler, "GET", async () =>
  (await import("@/lib/api/task-writes/search-orphans")).GET,
);
