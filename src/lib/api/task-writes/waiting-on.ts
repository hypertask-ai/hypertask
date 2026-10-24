import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import { setTaskWaitingOn } from "@/lib/tasks/setWaitingOn";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  prepare: (session) => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    const req = { body };
    try {
      const taskId = Number(req.body.taskId);
      const userId = req.body.userId == null ? req.body.userId : Number(req.body.userId);
      const blockerCommentId = req.body.blockerCommentId;
      if (!Number.isInteger(taskId) || (userId !== undefined && userId !== null && !Number.isInteger(userId))
        || (blockerCommentId !== undefined && blockerCommentId !== null && (!Number.isInteger(blockerCommentId) || blockerCommentId <= 0 || blockerCommentId > 2_147_483_647))
        || (userId === undefined && blockerCommentId === undefined)) {
        return NextResponse.json({ message: "Bad request" }, { status: 400 });
      }

      const result = await setTaskWaitingOn({ taskId, userId, blockerCommentId, currentUser });
      return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
      console.error("/api/tasks/waiting-on", error);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
