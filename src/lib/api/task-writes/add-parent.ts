import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  prepare: (session) => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    const req = { body };
    try {
      const { orphanId, parentId } = req.body;

      if (!orphanId || !parentId) {
        return NextResponse.json("Missing Required Data", { status: 200 });
      }

      const response = await updateTaskSingle({id: orphanId, parentTaskId: parentId}, currentUser)

      if (response.status === 200) {
        void broadcastBoardChange((response.json as any)?.projectId, { originUserId: currentUser.id });
      }

      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log("🚀 ~ error:", error);
      return NextResponse.json([], { status: 200 });
    }
  },
});
