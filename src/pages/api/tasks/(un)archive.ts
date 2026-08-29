import { NextApiHandler } from "next";
import prisma from "@/lib/prisma";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import createArchiveActivity from "@/utils/controllers/activities/createArchiveActivity";
import { IUser } from "@/models/model";
import { cancelDueDateJob } from "../queues/duedateQueue";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastInboxForTask } from "@/utils/controllers/notifications/broadcastInboxForTask";
import {
  broadcastBoardChange,
  broadcastTaskChange,
} from "@/lib/realtime/server";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { taskId, status, agentId } = req.body;
    const user =
      req.cookies.nookies_user && JSON.parse(req.cookies.nookies_user);

    if (!taskId || !user || !status) {
      return res.status(400).json({ message: "Missing required field" });
    }

    const agent = agentId
      ? await prisma.agent.findUnique({
          where: { id: agentId, revokedAt: null },
          select: { id: true, userId: true, displayName: true, photoURL: true },
        })
      : null;

    const now = new Date();
    const newTask = {
      id: taskId,
      status,
      archivedAt: status === "Archive" ? now : null,
      updatedAt: now,
      dueDate: null,
    };

    // This returns { json: updatedTask }
    // agent?.id, not the raw body value: the lookup above is what proves the
    // agent exists and is not revoked, and the gate needs it to accept an
    // agent-only membership.
    const { status: writeStatus, json: updatedTask }: any = await updateTaskSingle(
      newTask,
      user,
      agent?.id ?? null
    );

    // Same as setDueDate: stop before the activity and the queue work when
    // the write was refused (HTPR-4982).
    if (writeStatus !== 200) {
      return res.status(writeStatus).json(updatedTask);
    }

    if (status === "Archive") {
      await cancelDueDateJob(taskId, updatedTask.projectId);
    }

    // Archiving (or restoring) moves the task in or out of every inbox that
    // holds a notification for it, so those inboxes need a nudge (HTPR-4724).
    void broadcastInboxForTask(taskId);

    await createArchiveActivity({
      taskId,
      fromUserId: user.id,
      fromUserDisplayName: user.displayName,
      fromUser: user as IUser,
      newStatus: status,
      fromAgent: agent,
    });

    sendNotificationForTask(
      user.id,
      "TaskArchived",
      taskId,
      updatedTask.projectId,
      agentId ?? null
    );

    // Real-time: refresh this board for everyone watching it, and notify any
    // open task-detail views so they live-sync the archived/unarchived state
    // (HTPR-3980, HTPR-5690). originUserId is for other subscribers only.
    void broadcastBoardChange(updatedTask?.projectId, { originUserId: user.id });
    void broadcastTaskChange(updatedTask?.id ?? taskId, {
      originUserId: user.id,
    });

    return res.status(200).json(updatedTask);
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: String(error) });
  }
};

export default handler;
