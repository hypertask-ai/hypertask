import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import prisma from "@/lib/prisma";
import { broadcastBoardChange, broadcastInboxChange } from "@/lib/realtime/server";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import createActivity from "@/utils/controllers/activities/createActivity";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  prepare: (session) => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    const req = { body };
    try {
      const taskId = Number(req.body.taskId);
      const userId = req.body.userId === null ? null : Number(req.body.userId);
      if (!Number.isInteger(taskId) || (userId !== null && !Number.isInteger(userId))) {
        return NextResponse.json({ message: "Bad request" }, { status: 400 });
      }

      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
          status: { not: "Deleted" },
          project: getProjectWhere(currentUser.id),
        },
        select: { projectId: true, waitingOnUserId: true },
      });
      if (!task) {
        return NextResponse.json({ message: "Task not found" }, { status: 404 });
      }

      if (userId !== null) {
        const memberCheck = await validateProjectMemberIds(task.projectId, [userId]);
        if (memberCheck.error || memberCheck.invalidIds.length > 0) {
          return NextResponse.json({
            message:
              memberCheck.error?.message ??
              `User ${userId} is not a member of this project.`,
          }, { status: memberCheck.error?.status ?? 400 });
        }
      }

      const waitingOnUser = userId === null
        ? null
        : await prisma.user.findUnique({
            where: { id: userId },
            select: { displayName: true },
          });

      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data:
          userId === null
            ? {
                waitingOnUserId: null,
                waitingOnSetById: null,
                waitingOnSetAt: null,
              }
            : {
                waitingOnUserId: userId,
                waitingOnSetById: currentUser.id,
                waitingOnSetAt: new Date(),
              },
        select: {
          id: true,
          waitingOnUserId: true,
          waitingOnSetById: true,
          waitingOnSetAt: true,
        },
      });

      await createActivity({
        taskId,
        activityBody: {
          type: "TaskWaitingOn",
          data: {
            fromUserId: currentUser.id,
            fromUser: currentUser,
            waitingOnDisplayName: waitingOnUser?.displayName ?? null,
          },
        },
      });

      void broadcastBoardChange(task.projectId, { originUserId: currentUser.id });
      for (const affectedUserId of new Set(
        [task.waitingOnUserId, userId].filter(
          (id): id is number => typeof id === "number"
        )
      )) {
        void broadcastInboxChange(affectedUserId, { originUserId: currentUser.id });
      }

      return NextResponse.json(updatedTask, { status: 200 });
    } catch (error) {
      console.error("/api/tasks/waiting-on", error);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
