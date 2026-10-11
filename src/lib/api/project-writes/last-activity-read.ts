import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import getProjectsLastActivity from "@/utils/controllers/projects/lastActivity";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (_body, session) => {
    const response = await getProjectsLastActivity(session.userId);
    return NextResponse.json(response.json, { status: response.status });
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  return route({ headers: request.headers, json: async () => undefined }, session);
};
