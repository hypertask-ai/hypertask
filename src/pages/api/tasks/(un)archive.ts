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
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { taskId, status, agentId } = req.body;
    // Pages API auth is route-local: require a verified session (Better Auth or
    // signed ht_session). Do not fall back to unsigned nookies_user.id.
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>),
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!taskId || !status) {
      return res.status(400).json({ message: "Missing required field" });
    }

    const actingUserId = session.userId;
    const signedSession = verifySession(req.cookies[SESSION_COOKIE]);

    // HTPR-6376: agent actor comes from the signed session claim. Body agentId
    // may confirm that claim but cannot forge one.
    const actingAgent = resolveActingAgent({
      sessionAgentId: signedSession?.agentId ?? null,
      bodyAgentId: agentId,
    });
    if (!actingAgent.ok) {
      return res.status(actingAgent.status).json({ message: actingAgent.message });
    }

    // Audit display comes from the verified session's user row, never from
    // unsigned nookies_user metadata (same pattern as /api/tasks/single).
    const [sessionUser, agent] = await Promise.all([
      prisma.user.findUnique({
        where: { id: actingUserId },
        select: { displayName: true, photoURL: true, email: true },
      }),
      actingAgent.agentId
        ? prisma.agent.findFirst({
            where: {
              id: actingAgent.agentId,
              userId: actingUserId,
              revokedAt: null,
            },
            select: { id: true, userId: true, displayName: true, photoURL: true },
          })
        : Promise.resolve(null),
    ]);
    if (actingAgent.agentId && !agent) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!sessionUser) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = {
      id: actingUserId,
      displayName: sessionUser.displayName ?? "",
      photoURL: sessionUser.photoURL ?? undefined,
      email: sessionUser.email ?? undefined,
    };

    const now = new Date();
    const newTask = {
      id: taskId,
      status,
      archivedAt: status === "Archive" ? now : null,
      updatedAt: now,
      dueDate: null,
    };

    // agent?.id is the auth-bound, ownership-checked actor. Never pass the raw
    // body value through after the resolution above.
    const { status: writeStatus, json: updatedTask }: any = await updateTaskSingle(
      newTask,
      user as IUser,
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
      agent?.id ?? null
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
