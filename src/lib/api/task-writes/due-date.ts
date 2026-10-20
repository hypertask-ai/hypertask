import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";
import prisma from "@/lib/prisma";
import createTaskDueDateActivity from "@/utils/controllers/activities/createTaskDueDateActivity";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { subMinutes } from "date-fns";
import { cancelDueDateJob, scheduleDueDateJob } from "@/pages/api/queues/duedateQueue";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  prepare: async (session) => ({ user: await loadSessionUserRecord(session.userId), session }),
  operation: async (body, { user: userObj, session }) => {
    const req = { body };
    try {
      const { taskId, dueDate, agentId: requestedAgentId } = req.body;
      const actingAgent = resolveActingAgent({ sessionAgentId: session.agentId, bodyAgentId: requestedAgentId });
      if (!actingAgent.ok) {
        return NextResponse.json({ message: actingAgent.message }, { status: actingAgent.status });
      }
      const agentId = actingAgent.agentId;

      if (!taskId) {
        return NextResponse.json({ message: "Missing required field" }, { status: 400 });
      }

      const agent = agentId
        ? await prisma.agent.findUnique({
            where: { id: agentId, revokedAt: null },
            select: { id: true, userId: true, displayName: true, photoURL: true },
          })
        : null;

      const { status, json: task, oldTask }: any = await updateTaskSingle(
        { id: taskId, dueDate: dueDate ?? null, dueDateNotifiedAt: null },
        userObj,
        agentId ?? null
      );

      if (status !== 200) {
        return NextResponse.json(task, { status });
      }

      const dueDateChanged =
        (oldTask?.dueDate?.getTime?.() ?? null) !==
        (task?.dueDate?.getTime?.() ?? null);
      if (dueDateChanged) {
        sendNotificationForTask(
          userObj.id,
          "TaskDueDate",
          taskId,
          task.projectId,
          agentId ?? null
        );
      }

      createTaskDueDateActivity({
        taskId,
        userObj,
        toDueDate: dueDate,
        fromDueDate: oldTask?.dueDate,
        fromAgent: agent,
      });

      await cancelDueDateJob(taskId, task.projectId);
      if (dueDate) {
        await scheduleDueDateJob(
          { taskId, projectId: task.projectId },
          subMinutes(dueDate, 0),
        );
      }

      if (status === 200) {
        void broadcastBoardChange(task?.projectId, { originUserId: userObj.id });
        void broadcastTaskChange(task?.id ?? Number(taskId), {
          originUserId: userObj.id,
        });
      }

      return NextResponse.json(task, { status: 200 });
    } catch (error) {
      console.error(error);
      return NextResponse.json({ message: "Internal server error", error: String(error) }, { status: 500 });
    }
  },
});
