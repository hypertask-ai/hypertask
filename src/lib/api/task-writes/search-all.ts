import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import tasksSearchAll from "@/utils/controllers/tasks/searchAll";
import getRecentlyWorkedTasks from "@/utils/controllers/tasks/getRecentlyWorkedTasks";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required field",
  allowNullBody: true,
  operation: async (body, session) => {
    try {
      const { projectIds, searchQuery, mode, currentTaskId } = body;

      if (mode === "recent") {
        const response = await getRecentlyWorkedTasks({
          userId: session.userId,
          projectIds,
          currentTaskId: Number(currentTaskId),
        });
        return NextResponse.json(response.json, { status: response.status });
      }

      if (!projectIds || !searchQuery) {
        return NextResponse.json("Missing Required Data", { status: 200 });
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

      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log(error);
      return NextResponse.json([], { status: 200 });
    }
  },
});

export const POST: TaskWriteRoute = async (request, session) => {
  return route(request, session);
};
