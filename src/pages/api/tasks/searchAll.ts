import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import tasksSearchAll from "@/utils/controllers/tasks/searchAll";
import getRecentlyWorkedTasks from "@/utils/controllers/tasks/getRecentlyWorkedTasks";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { projectIds, searchQuery, mode, currentTaskId } = req.body;

      if (mode === "recent") {
        const response = await getRecentlyWorkedTasks({
          userId: session.userId,
          projectIds,
          currentTaskId: Number(currentTaskId),
        });
        return res.status(response.status).json(response.json);
      }

      if (!projectIds || !searchQuery) {
        return res.status(200).json("Missing Required Data");
      }

      const requestedProjectIds = (Array.isArray(projectIds) ? projectIds : [])
        .map((projectId) => Number(projectId))
        .filter((projectId) => Number.isInteger(projectId) && projectId > 0);
      const accessibleProjects = requestedProjectIds.length
        ? await prisma.project.findMany({
            where: {
              id: { in: requestedProjectIds },
              ...getProjectWhere(session.userId),
            },
            select: { id: true },
          })
        : [];

      // =========== instant search
      const response = await tasksSearchAll(
        accessibleProjects.map((project) => project.id),
        searchQuery
      );
      // Assuming otherResponse and response are arrays of objects

      return res.status(response.status).json(response.json);
    } catch (error) {
      console.log(error);
      return res.status(200).json([]);
    }
  } else {
    return res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
