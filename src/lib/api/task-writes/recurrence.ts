import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { isRecurrenceRule } from "@/lib/recurrence";
import { userCanAccessTask } from "@/utils/controllers/tasks/assertTaskAccess";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

// HTPR-4885: set/clear a task's repeat rule. The rule sits on the task until
// it is completed; spawnRecurrence.ts then moves it to the next occurrence.

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  prepare: (session) => loadSessionUserRecord(session.userId),
  operation: async (body, userObj) => {
    const req = { body };
    try {
      const { taskId, recurrence } = req.body;
      if (!taskId) {
        return NextResponse.json({ message: "Missing required field" }, { status: 400 });
      }
      if (recurrence != null && !isRecurrenceRule(recurrence)) {
        return NextResponse.json({ message: "Invalid recurrence rule" }, { status: 400 });
      }

      // updateTaskSingle writes by id without checking membership, so gate here.
      // No agentId: it would come from the request body, and the agent branch of
      // getProjectWhere checks board membership of that agent, not that the
      // caller owns it — a body-supplied id would be a cross-account write.
      if (!(await userCanAccessTask(userObj.id, Number(taskId)))) {
        return NextResponse.json({ message: "Task not found" }, { status: 404 });
      }

      const { status, json: task }: any = await updateTaskSingle(
        { id: taskId, recurrence: recurrence ?? null },
        userObj,
        null
      );

      if (status === 200) {
        void broadcastBoardChange(task?.projectId, { originUserId: userObj.id });
      }

      return NextResponse.json(task, { status });
    } catch (error) {
      console.error(error);
      return NextResponse.json({ message: "Internal server error", error: String(error) }, { status: 500 });
    }
  },
});
