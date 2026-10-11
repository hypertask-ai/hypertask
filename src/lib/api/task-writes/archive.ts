import { NextResponse } from "next/server";
import { z } from "zod";
import { parseCookies } from "better-auth/cookies";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import prisma from "@/lib/prisma";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import createArchiveActivity from "@/utils/controllers/activities/createArchiveActivity";
import { IUser } from "@/models/model";
import { cancelDueDateJob } from "@/pages/api/queues/duedateQueue";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { broadcastInboxForTask } from "@/utils/controllers/notifications/broadcastInboxForTask";
import {
  broadcastBoardChange,
  broadcastTaskChange,
} from "@/lib/realtime/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { resolveActingAgent } from "@/lib/auth/resolveActingAgent";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>((body) => !!((body as any)?.taskId && (body as any)?.status)),
  validationMessage: "Missing required field",
  operation: async ({ taskId, status, agentId }, session, request) => {
    const actingUserId = session.userId;
    const signedSession = verifySession(request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));

    // HTPR-6376: agent actor comes from the signed session claim. Body agentId
    // may confirm that claim but cannot forge one.
    const actingAgent = resolveActingAgent({
      sessionAgentId: signedSession?.agentId ?? null,
      bodyAgentId: agentId,
    });
    if (!actingAgent.ok) {
      return NextResponse.json({ message: actingAgent.message }, { status: actingAgent.status });
    }

    // Audit display comes from the verified session's user row.
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
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    if (!sessionUser) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
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
      return NextResponse.json(updatedTask, { status: writeStatus });
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

    return NextResponse.json(updatedTask, { status: 200 });
  },
});

export const POST: TaskWriteRoute = async (request, session) => {
  try {
    const body = await request.json();
    // The legacy 500 exposes req.body in its pre-auth destructuring error text.
    const req = { body };
    const { taskId } = req.body;
    void taskId;
    return await route({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ message: "Internal server error", error: String(error) }, { status: 500 });
  }
};
