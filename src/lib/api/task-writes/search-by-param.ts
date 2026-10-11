import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRequest, type TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
import taskSearchByParam from "@/utils/controllers/tasks/taskSearchByParam";
import { httpStatusConfig } from "@/lib/configs/http-status.config";

const route = taskWriteRoute({
  schema: z.custom<NonNullable<TaskWriteRequest["query"]>>(() => true),
  validationMessage: "Missing required field",
  allowNullBody: true,
  operation: async (query, session) => {
    const userId = session.userId;
    try {
      const { param, projectId } = query;
      if (!param || !projectId)
        return NextResponse.json({ message: httpStatusConfig.statusCodes[400].userMessage }, { status: 400 });

      const response = await taskSearchByParam(
        param as string,
        userId,
        parseInt(projectId as string)
      );
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log("🤔 ~ TaskSearchByParams ERROR:", error);
      return NextResponse.json({ message: httpStatusConfig.statusCodes[500].userMessage }, { status: 500 });
    }
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  return route({ headers: request.headers, json: async () => taskReadQuery(request) }, session);
};
