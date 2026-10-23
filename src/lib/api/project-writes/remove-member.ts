import { NextResponse } from "next/server";
import { z } from "zod";
import { legacyTaskWriteSession, taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import membersRemove from "@/utils/controllers/projects/removeMember";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    try {
      const { userId, projectId } = req.body;
      console.log("🚀 ~ file: removeMember.ts:9 ~ consthandler:NextApiHandler= ~ req.body:", req.body);
      if (!userId || !projectId) {
        return NextResponse.json({ message: "Missing required information" }, { status: 400 });
      }
      const response = await membersRemove(userId, projectId, session.userId);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log(error);
      return NextResponse.json({ message: JSON.stringify(error) }, { status: 400 });
    }
  },
});

export const POST: TaskWriteRoute = async (request) => {
  const session = await legacyTaskWriteSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route(request, session);
};
