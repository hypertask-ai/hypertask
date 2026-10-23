import { NextResponse } from "next/server";
import { z } from "zod";
import { legacyTaskWriteSession, taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import getFirst from "@/utils/controllers/projects/getFirst";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (_body, session) => {
    try {
      const response = await getFirst(session.userId);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log(error);
      return NextResponse.json({ message: JSON.stringify(error) }, { status: 400 });
    }
  },
});

export const GET: TaskWriteRoute = async (request) => {
  const session = await legacyTaskWriteSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route({ headers: request.headers, json: async () => undefined }, session);
};
