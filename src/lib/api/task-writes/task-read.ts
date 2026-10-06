import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRequest, type TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
import tasksGetTask from "@/utils/controllers/tasks/getTask";
import { httpStatusConfig } from "@/lib/configs/http-status.config";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

const route = taskWriteRoute({
  schema: z.custom<NonNullable<TaskWriteRequest["query"]>>(() => true),
  validationMessage: "Missing required field",
  allowNullBody: true,
  prepare: async (session) => loadSessionUserRecord(session.userId),
  operation: async (query, userObj) => {
    try {
      const { project, uniqueIndex } = query;
      if (!uniqueIndex || !project) {
        return NextResponse.json({ message: httpStatusConfig.statusCodes[400].userMessage }, { status: 400, headers: privateHeaders });
      }
      const response = await tasksGetTask(
        project as string,
        uniqueIndex as string,
        userObj
      );

      return NextResponse.json(response.json, { status: response.status, headers: privateHeaders });
    } catch (error) {
      console.log({ error });
      return NextResponse.json({ message: httpStatusConfig.statusCodes[500].userMessage }, { status: 500, headers: privateHeaders });
    }
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  const response = await route({ headers: request.headers, json: async () => taskReadQuery(request) }, session);
  if (response) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
  }
  return response;
};
