import { IFCMReqBody } from "@/models/model";
import { sendDataNewCommentFCM } from "@/utils/controllers/FCM";
import prisma from "@/lib/prisma";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { createAgentMentionNotification } from "@/utils/controllers/notifications/createAgentMentionNotification";
import { checkIfBoardMember } from "@/utils/controllers/tasks/getSharedTask";

export async function createFollowerService(params: {
  userId?: number;
  agentId?: string | null;
  taskId: number;
  mentionById: number;
  commentId?: number;
  fromAgentId?: string | null;
}): Promise<{ status: number; body: any }> {
  try {
    const { taskId, mentionById, agentId, commentId, fromAgentId } = params;
    let { userId } = params;
    const agent = agentId
      ? await prisma.agent.findFirst({
          where: {
            id: agentId,
            revokedAt: null,
          },
        })
      : undefined;

    if (!userId && agentId && agent) userId = agent.userId;

    if (!userId || !taskId) {
      return { status: 400, body: { message: "Missing required information." } };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { userId: true, projectId: true, agentId: true },
    });

    if (!task) {
      return { status: 404, body: { message: "Task not found." } };
    }

    const notifyAgentMention = async () => {
      if (!agentId || !agent) return;
      await createAgentMentionNotification({
        agentId,
        taskId,
        projectId: task.projectId,
        mentionedBy: mentionById,
        commentId,
        fromAgentId,
      });
    };

    // Task owner should never be in followers
    if (!agentId && task.userId === userId) {
      return { status: 201, body: "Task owner cannot be added as follower." };
    }

    //If Agent was the task owner
    if (agentId && task.agentId === agentId) {
      await notifyAgentMention();
      return { status: 201, body: "Task owner cannot be added as follower." };
    }

    const assignee = await prisma.assignees.findFirst({
      where: {
        userId,
        taskId,
        agentId,
      },
    });

    if (assignee) {
      await notifyAgentMention();
      return { status: 201, body: "User/Agent exists as an assignee." };
    }

    //If user is validated, their agent will automatically get validated as well.
    const boardAccess = await checkIfBoardMember(userId, task.projectId);

    if (boardAccess === 201) {
      return {
        status: 403,
        body: { message: "User does not belong in this board." },
      };
    }
    if (boardAccess !== 200) {
      return { status: 404, body: { message: "Board not found." } };
    }

    // Prevent duplicate followers
    const existingFollower = await prisma.follower.findFirst({
      where: {
        userId,
        taskId,
        agentId,
      },
    });

    if (existingFollower) {
      await notifyAgentMention();
      return { status: 201, body: "User/Agent is already a follower." };
    }

    const newFollower = await prisma.follower.create({
      data: {
        userId,
        taskId,
        mentionById,
        agentId,
      },
      include: {
        task: true,
      },
    });

    // =================== create notification
    const devices = await prisma.subscribedDevices.findMany({
      where: {
        userId: userId,
      },
    });

    const mentionedBy = await prisma.user.findFirst({
      where: {
        id: mentionById,
      },
    });

    const notificationTargetUserId = agent ? agent.userId : userId;
    const notification = await checkReminderAndCreateNotification(
      notificationTargetUserId,
      newFollower.task.projectId,
      taskId,
      {
        userId: notificationTargetUserId,
        fromUserId: mentionById,
        type: "AddedToFollowerInTask",
        taskId,
        projectId: newFollower.task.projectId,
        ...(agentId ? { agentId: agentId } : {}),
      },
    );

    await notifyAgentMention();

    //This will always go to human user if they were mentioned :)
    if (notification && !agentId) {
      const body: IFCMReqBody = {
        type: "addFollower",
        notificationTitle: `${mentionedBy?.displayName?.trim() || "Someone"} added you to a task`,
        notificationBody: newFollower.task.title,
        devices: devices,
        payload: newFollower,
        taskTitle: newFollower.task.title,
        afterAppDomain: `detail/project-${newFollower.task.projectId}/${newFollower.task.uniqueIndex}`,
      };

      await sendDataNewCommentFCM(body);
    }

    return { status: 200, body: newFollower };
  } catch (error) {
    console.log(
      "🚀 ~ handler ~ error in /api/follower/createFollower:",
      error,
    );
    return { status: 400, body: { message: JSON.stringify(error) } };
  }
}
