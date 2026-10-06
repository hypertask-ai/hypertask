import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRequest, type TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
import tasksGetArchivedTasksByProject from "@/utils/controllers/tasks/getArchivedTasksByProject";

const route = taskWriteRoute({
  schema: z.custom<NonNullable<TaskWriteRequest["query"]>>(() => true),
  validationMessage: "Missing required field",
  allowNullBody: true,
  operation: async (query, session) => {
    const userId = session.userId;
    try {
      const { projectId } = query;

      if (!projectId) {
        return NextResponse.json({ message: "Missing required field" }, { status: 400 });
      }

      const response = await tasksGetArchivedTasksByProject(projectId, userId);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log(error);
      return NextResponse.json([], { status: 400 });
    }
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  return route({ headers: request.headers, json: async () => taskReadQuery(request) }, session);
};
