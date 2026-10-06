import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { userCanAccessTask } from "@/utils/controllers/tasks/assertTaskAccess";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

// HTPR-4884: set/clear a task's planned start date. Mirrors setDueDate.ts but
// deliberately lighter: no queue job and no notification fire off a start date.

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  prepare: (session) => loadSessionUserRecord(session.userId),
  operation: async (body, userObj) => {
    const req = { body };
    try {
      const { taskId, startDate } = req.body;
      if (!taskId) {
        return NextResponse.json({ message: "Missing required field" }, { status: 400 });
      }

      // updateTaskSingle writes by id without checking membership, so gate here.
      // No agentId: it would come from the request body, and the agent branch of
      // getProjectWhere checks board membership of that agent, not that the
      // caller owns it — a body-supplied id would be a cross-account write.
      if (!(await userCanAccessTask(userObj.id, Number(taskId)))) {
        return NextResponse.json({ message: "Task not found" }, { status: 404 });
      }

      const { status, json: task }: any = await updateTaskSingle(
        { id: taskId, startDate: startDate ? new Date(startDate) : null },
        userObj,
        null
      );

      if (status === 200) {
        void broadcastBoardChange(task?.projectId, { originUserId: userObj.id });
        // HTPR-6281: the open task detail view listens only on the task channel.
        void broadcastTaskChange(task?.id ?? Number(taskId), {
          originUserId: userObj.id,
        });
      }

      return NextResponse.json(task, { status });
    } catch (error) {
      console.error(error);
      return NextResponse.json({ message: "Internal server error", error: String(error) }, { status: 500 });
    }
  },
});
