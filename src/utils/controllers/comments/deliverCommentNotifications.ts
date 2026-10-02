import type { CommentDependencies } from './commentCreationTypes';
import { sendCommentEmails } from './commentNotifications';
import type { CommentFanoutContext, CommentNotificationClaim, CommentNotificationState } from './commentFanoutTypes';

export async function deliverCommentNotifications(
  context: CommentFanoutContext,
  agentRunCommentNotificationClaim: CommentNotificationClaim,
  agentRunCommentNotificationState: CommentNotificationState,
  notificationDeliveryKeys: Set<string>,
  renewNotificationClaim: () => Promise<void>,
  checkpointNotificationDelivery: (key: string) => Promise<void>,
  recipientUserIds: number[],
  mentionedUserIds: Set<number>,
  commentCreator: Awaited<ReturnType<CommentDependencies['prisma']['user']['findFirst']>>,
  userIds: number[],
) {
  const { dependencies } = context;
  const { prisma, sendDataOnlyFcm, broadcastTaskComment, completeInboundEmailProcessing } = dependencies;
  const { task, taskId, creatorId, currentUser, agentId, accessUserId, inboundEmailId, agentRunActivity, agentRunSelection, agentRunReplayComment } = context;
  const { comment, inboundProcessingStartedAt } = context.transactionResult;
  const committedText = comment.text;
  const isAgentRunComment = Boolean(agentRunActivity || agentRunSelection || agentRunReplayComment);
  if (isAgentRunComment) {
    if (
      !agentRunCommentNotificationClaim ||
      !agentRunCommentNotificationState
    ) {
      throw new Error("Run activity notification claim is missing");
    }
    // ponytail: per-target checkpoints follow successful handoff, so a process
    // exit between handoff and checkpoint can still duplicate that target.
    // Exactly-once needs provider-idempotent outboxes.
    if (!agentRunCommentNotificationState.commentFcmAttemptedAt) {
      const devices = await prisma.subscribedDevices.findMany({
        where: { userId: { in: userIds } },
      });
      await sendDataOnlyFcm(
        devices,
        commentCreator!,
        task.title,
        task.uniqueIndex,
        task.projectId,
        creatorId,
        comment,
        {
          failOnError: true,
          deliveredDeviceIds: new Set(
            [...notificationDeliveryKeys]
              .filter((key) => key.startsWith("fcm:"))
              .map((key) => key.slice("fcm:".length)),
          ),
          beforeDelivery: renewNotificationClaim,
          markDelivered: (firebaseId) =>
            checkpointNotificationDelivery(`fcm:${firebaseId}`),
        },
      );
      const checkpointed = await prisma.agentRunActivity.updateMany({
        where: {
          id: agentRunCommentNotificationClaim.activityId,
          commentNotificationsProcessingAt:
            agentRunCommentNotificationClaim.processingAt,
          commentFcmAttemptedAt: null,
        },
        data: { commentFcmAttemptedAt: new Date() },
      });
      if (checkpointed.count === 0) {
        throw new Error("Run activity FCM notification claim was lost");
      }
    }
    if (!agentRunCommentNotificationState.commentEmailsAttemptedAt) {
      await sendCommentEmails(dependencies, {
        task,
        text: committedText,
        creatorId,
        currentUser,
        recipientUserIds,
        mentionedUserIds,
        fromAgentId: agentId ?? null,
        deliveredUserIds: new Set(
          [...notificationDeliveryKeys]
            .filter((key) => key.startsWith("email:"))
            .map((key) => Number(key.slice("email:".length))),
        ),
        beforeDelivery: renewNotificationClaim,
        markDelivered: (userId) =>
          checkpointNotificationDelivery(`email:${userId}`),
      });
      const checkpointed = await prisma.agentRunActivity.updateMany({
        where: {
          id: agentRunCommentNotificationClaim.activityId,
          commentNotificationsProcessingAt:
            agentRunCommentNotificationClaim.processingAt,
          commentEmailsAttemptedAt: null,
        },
        data: { commentEmailsAttemptedAt: new Date() },
      });
      if (checkpointed.count === 0) {
        throw new Error("Run activity email notification claim was lost");
      }
    }
    // Keep the realtime handoff inside the lease so an interrupted request
    // can retry it, while completed duplicate requests remain side-effect free.
    await renewNotificationClaim();
    await broadcastTaskComment(taskId, {
      originUserId: accessUserId ?? currentUser.id,
    });
    const completed = await prisma.agentRunActivity.updateMany({
      where: {
        id: agentRunCommentNotificationClaim.activityId,
        commentNotificationsCompletedAt: null,
        commentNotificationsProcessingAt:
          agentRunCommentNotificationClaim.processingAt,
      },
      data: {
        commentNotificationsCompletedAt: new Date(),
        commentNotificationsProcessingAt: null,
      },
    });
    if (completed.count === 0) {
      throw new Error("Run activity notification claim was lost");
    }
    agentRunCommentNotificationClaim = null;
  } else {
    const devices = await prisma.subscribedDevices.findMany({
      where: { userId: { in: userIds } },
    });
    const fcmDelivery = sendDataOnlyFcm(
      devices,
      commentCreator!,
      task.title,
      task.uniqueIndex,
      task.projectId,
      creatorId,
      comment,
    );
    if (inboundEmailId) {
      await fcmDelivery;
      await sendCommentEmails(dependencies, {
        task,
        text: committedText,
        creatorId,
        currentUser,
        recipientUserIds,
        mentionedUserIds,
        fromAgentId: agentId ?? null,
      }).catch((err) =>
        console.warn("[createCommentService] sendCommentEmails failed:", err),
      );
      if (!inboundProcessingStartedAt) {
        throw new Error("Inbound email processing lease is missing");
      }
      await completeInboundEmailProcessing(
        prisma,
        inboundEmailId,
        comment.id,
        inboundProcessingStartedAt,
      );
    } else {
      void fcmDelivery.catch((error) =>
        console.warn("[createCommentService] FCM delivery failed:", error),
      );
      await sendCommentEmails(dependencies, {
        task,
        text: committedText,
        creatorId,
        currentUser,
        recipientUserIds,
        mentionedUserIds,
        fromAgentId: agentId ?? null,
      }).catch((err) =>
        console.warn("[createCommentService] sendCommentEmails failed:", err),
      );
    }
  }
  return agentRunCommentNotificationClaim;
}
