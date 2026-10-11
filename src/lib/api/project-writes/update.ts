import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import updateProject from "@/utils/controllers/projects/update";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  prepare: session => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    const req = { body };
    try {
      const { projectId, title, sorting_mode, uniqueIdentifier } = req.body;
      const response = await updateProject(projectId, title, sorting_mode, uniqueIdentifier, currentUser);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to update board" }, { status: 400 });
    }
  },
});
