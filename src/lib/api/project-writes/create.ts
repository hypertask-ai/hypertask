import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import create from "@/utils/controllers/projects/create";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing required information",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    try {
      const { title, teamId, googleAccountId, ticketPrefix } = req.body;
      const response = await create(session.userId, title, teamId, googleAccountId, ticketPrefix);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to create board" }, { status: 400 });
    }
  },
});
