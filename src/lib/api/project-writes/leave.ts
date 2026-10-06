import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import leaveProject from "@/utils/controllers/projects/leave";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const { projectId } = req.body;
    try {
      const response = await leaveProject(projectId, session.userId);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.error(error);
      return NextResponse.json({ error: "Failed to add new section" }, { status: 500 });
    }
  },
});
