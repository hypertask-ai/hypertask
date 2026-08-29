import { NextApiHandler } from "next";
import prisma from "@/lib/prisma";
import createTaskDueDateActivity from "@/utils/controllers/activities/createTaskDueDateActivity";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { subMinutes } from "date-fns";
import { cancelDueDateJob, scheduleDueDateJob } from "../queues/duedateQueue";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastBoardChange } from "@/lib/realtime/server";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { taskId, dueDate, agentId } = req.body;
    const userObj =
      req.cookies?.nookies_user && JSON.parse(req.cookies.nookies_user);
    if (!taskId || !userObj) {
      return res.status(400).json({ message: "Missing required field" });
    }

    // Only fetch agent if agentId is provided
    const agent = agentId
      ? await prisma.agent.findUnique({
          where: { id: agentId, revokedAt: null },
          select: { id: true, userId: true, displayName: true, photoURL: true },
        })
      : null;

    // Update task dueDate
    const { status, json: task, oldTask }: any = await updateTaskSingle(
      // dueDateNotifiedAt reset so a moved due date re-notifies (see invokeDueDate.ts).
      { id: taskId, dueDate: dueDate ?? null, dueDateNotifiedAt: null },
      userObj,
      agentId ?? null
    );

    // A denied write returns an error payload here, not a task. Falling
    // through would log an activity and reschedule the due-date job for a
    // board the caller cannot see (HTPR-4982).
    if (status !== 200) {
      return res.status(status).json(task);
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

    // Log activity
    createTaskDueDateActivity({
      taskId,
      userObj,
      toDueDate: dueDate,
      fromDueDate: oldTask?.dueDate,
      fromAgent: agent,
    });

    // Manage due date queue
    await cancelDueDateJob(taskId, task.projectId);
    if (dueDate) {
      await scheduleDueDateJob(
        { taskId, projectId: task.projectId },
        subMinutes(dueDate, 0),
      );
    }

    if (status === 200) {
      void broadcastBoardChange(task?.projectId, { originUserId: userObj.id });
    }

    return res.status(200).json(task);
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: String(error) });
  }
};

export default handler;
