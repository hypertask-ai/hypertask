import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import RenameSection from "@/utils/controllers/section/rename";
import { sectionWriteJson } from "./response";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing Required Data",
  allowNullBody: true,
  operation: async (body, session) => {
    const req = { body };
    const userId = session.userId;
    const { sectionId, newSection } = req.body;
    if (!sectionId || !newSection) {
      return NextResponse.json({ message: "Missing Required Data" }, { status: 400 });
    }
    try {
      const response = await RenameSection(userId, sectionId, newSection);
      return sectionWriteJson(response?.json, response?.status);
    } catch (error) {
      console.error("Error:", error);
    }
  },
});
