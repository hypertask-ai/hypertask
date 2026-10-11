import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import sectionGetProjectSections from "@/utils/controllers/section/getProjectSections";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing Required Credentials",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const userId = session.userId;
    const { projectId } = req.body;
    if (!projectId) {
      return NextResponse.json({ message: "Missing Required Credentials" }, { status: 400 });
    }
    try {
      const response = await sectionGetProjectSections(projectId, userId);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.error("Error:", error);
    }
  },
});
