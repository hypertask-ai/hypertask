import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import setMemberRole from "@/utils/controllers/projects/setMemberRole";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    try {
      const { projectId, targetUserId, role } = req.body;
      const response = await setMemberRole(session.userId, projectId, targetUserId, role);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.error(error);
      return NextResponse.json({ message: JSON.stringify(error) }, { status: 400 });
    }
  },
});
