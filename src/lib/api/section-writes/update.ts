import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import sectionUpdate from "@/utils/controllers/section/update";
import { broadcastBoardChange } from "@/lib/realtime/server";
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
      const response = await sectionUpdate(userId, sectionId, newSection);
      if (response?.status === 200 || response?.status === 204) {
        void broadcastBoardChange((response?.json as any)?.projectId ?? newSection?.projectId, { originUserId: userId });
      }
      return sectionWriteJson(response?.json, response?.status);
    } catch (error) {
      console.error("Error:", error);
      return NextResponse.json({ message: "Section update failed" }, { status: 500 });
    }
  },
});
