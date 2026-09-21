import type { NextApiHandler } from "next";
import prisma from "@/lib/prisma";
import { broadcastBoardChange, broadcastInboxChange } from "@/lib/realtime/server";
import { validateProjectMemberIds } from "@/lib/mcp/tasks/services";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import createActivity from "@/utils/controllers/activities/createActivity";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const taskId = Number(req.body.taskId);
    const userId = req.body.userId === null ? null : Number(req.body.userId);
    if (!Number.isInteger(taskId) || (userId !== null && !Number.isInteger(userId))) {
      return res.status(400).json({ message: "Bad request" });
    }

    const currentUser = JSON.parse(req.cookies.nookies_user ?? "null");
    if (!Number.isInteger(currentUser?.id)) {
      return res.status(401).json({ message: "Unauthorized" });
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
      return res.status(404).json({ message: "Task not found" });
    }

    if (userId !== null) {
      const memberCheck = await validateProjectMemberIds(task.projectId, [userId]);
      if (memberCheck.error || memberCheck.invalidIds.length > 0) {
        return res.status(memberCheck.error?.status ?? 400).json({
          message:
            memberCheck.error?.message ??
            `User ${userId} is not a member of this project.`,
        });
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

    return res.status(200).json(updatedTask);
  } catch (error) {
    console.error("/api/tasks/waiting-on", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
