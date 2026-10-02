import { resolveCommentRecipientUserIds, createNotificationForComment, processTaskReferencesFromCommentText } from './commentNotifications';
import { prepareCommentNotifications } from './prepareCommentNotifications';
import { deliverCommentNotifications } from './deliverCommentNotifications';
import type { CommentFanoutContext } from './commentFanoutTypes';

const AGENT_RUN_COMMENT_NOTIFICATION_LEASE_MS = 5 * 60_000;

export async function fanOutCommentNotifications(context: CommentFanoutContext) {
  const { dependencies } = context;
  const { publishAgentWebhookDeliveries, publishBoardWebhookDeliveries, prisma, AgentRunActivityInProgressError, getMentionedUserIdsFromCommentText, processMentionsFromCommentText, idsToSendNotificationsTo, releaseInboundEmailProcessing } = dependencies;
  const { creatorId, taskId, ownerId, currentUser, agentId, accessUserId, processTaskReferences = true, inboundEmailId, agentRunActivity, agentRunSelection, agentRunReplayComment, task, creatorIdNum } = context;
  const transactionResult = context.transactionResult;
  const {
    comment,
    webhookDeliveryIds,
    boardWebhookDeliveryIds,
    resolvedDirectReplyUserId,
    inboundCompleted,
    inboundProcessingStartedAt,
  } = transactionResult;
  if (inboundCompleted) return comment;
  const committedText = comment.text;
  const isAgentRunComment = Boolean(
    agentRunActivity || agentRunSelection || agentRunReplayComment,
  );
  if (agentRunReplayComment?.notificationsCompletedAt) {
    await publishAgentWebhookDeliveries(webhookDeliveryIds);
    await publishBoardWebhookDeliveries(boardWebhookDeliveryIds);
    return comment;
  }
  let agentRunCommentNotificationClaim: {
    activityId: string;
    processingAt: Date;
  } | null = null;
  let agentRunCommentNotificationState: {
    commentNotificationDeliveryKeys: string[];
    commentMentionsAttemptedAt: Date | null;
    commentFcmAttemptedAt: Date | null;
    commentEmailsAttemptedAt: Date | null;
  } | null = null;
  try {
    if (isAgentRunComment) {
      const activityId =
        agentRunActivity?.id ??
        agentRunSelection?.activityId ??
        agentRunReplayComment?.activityId;
      if (!activityId) {
        throw new Error("Run activity comment is missing its activity");
      }
      const processingAt = new Date();
      const staleBefore = new Date(
        processingAt.getTime() - AGENT_RUN_COMMENT_NOTIFICATION_LEASE_MS,
      );
      const claimed = await prisma.agentRunActivity.updateMany({
        where: {
          id: activityId,
          commentNotificationsCompletedAt: null,
          OR: [
            { commentNotificationsProcessingAt: null },
            { commentNotificationsProcessingAt: { lte: staleBefore } },
          ],
        },
        data: { commentNotificationsProcessingAt: processingAt },
      });
      if (claimed.count === 0) {
        const state = await prisma.agentRunActivity.findUnique({
          where: { id: activityId },
          select: { commentNotificationsCompletedAt: true },
        });
        if (state?.commentNotificationsCompletedAt) return comment;
        if (state) {
          throw new AgentRunActivityInProgressError(
            "Run activity comment notifications are still processing",
          );
        }
        throw new Error("Run activity comment was not found");
      }
      agentRunCommentNotificationClaim = { activityId, processingAt };
      agentRunCommentNotificationState =
        await prisma.agentRunActivity.findUniqueOrThrow({
          where: { id: activityId },
          select: {
            commentNotificationDeliveryKeys: true,
            commentMentionsAttemptedAt: true,
            commentFcmAttemptedAt: true,
            commentEmailsAttemptedAt: true,
          },
        });
    }

    const notificationDeliveryKeys = new Set(
      agentRunCommentNotificationState?.commentNotificationDeliveryKeys ?? [],
    );
    const checkpointNotificationDelivery = async (key: string) => {
      if (notificationDeliveryKeys.has(key)) return;
      if (!agentRunCommentNotificationClaim) {
        throw new Error("Run activity notification claim is missing");
      }
      const checkpointed = await prisma.agentRunActivity.updateMany({
        where: {
          id: agentRunCommentNotificationClaim.activityId,
          commentNotificationsProcessingAt:
            agentRunCommentNotificationClaim.processingAt,
        },
        data: { commentNotificationDeliveryKeys: { push: key } },
      });
      if (checkpointed.count === 0) {
        throw new Error("Run activity notification delivery claim was lost");
      }
      notificationDeliveryKeys.add(key);
    };
    const renewNotificationClaim = async () => {
      if (!agentRunCommentNotificationClaim) {
        throw new Error("Run activity notification claim is missing");
      }
      const renewedAt = new Date(
        Math.max(
          Date.now(),
          agentRunCommentNotificationClaim.processingAt.getTime() + 1,
        ),
      );
      const renewed = await prisma.agentRunActivity.updateMany({
        where: {
          id: agentRunCommentNotificationClaim.activityId,
          commentNotificationsCompletedAt: null,
          commentNotificationsProcessingAt:
            agentRunCommentNotificationClaim.processingAt,
        },
        data: { commentNotificationsProcessingAt: renewedAt },
      });
      if (renewed.count === 0) {
        throw new Error("Run activity notification claim was lost");
      }
      agentRunCommentNotificationClaim.processingAt = renewedAt;
    };

    await prepareCommentNotifications(context);

    const recipientUserIds = await resolveCommentRecipientUserIds(dependencies, 
      task,
      creatorId,
      ownerId,
      agentId ?? null,
    );
    if (resolvedDirectReplyUserId != null) {
      recipientUserIds.push(resolvedDirectReplyUserId);
    }
    const mentionedUserIds = new Set(
      getMentionedUserIdsFromCommentText(committedText),
    );
    const runMentionProcessing = () =>
      processMentionsFromCommentText({
        text: committedText,
        commentId: comment.id,
        taskId,
        projectId: task.projectId,
        mentionedBy: creatorIdNum,
        fromAgentId: agentId ?? null,
        failOnError: isAgentRunComment,
        skipUserIds:
          resolvedDirectReplyUserId === null
            ? []
            : [resolvedDirectReplyUserId],
        ...(isAgentRunComment
          ? {
              deliveryProgress: {
                has: (stage: string, recipient: number | string) =>
                  notificationDeliveryKeys.has(`mention:${stage}:${recipient}`),
                beforeDelivery: renewNotificationClaim,
                mark: (stage: string, recipient: number | string) =>
                  checkpointNotificationDelivery(
                    `mention:${stage}:${recipient}`,
                  ),
              },
            }
          : {}),
      });
    let mentionProcessing: Promise<void> = Promise.resolve();
    if (isAgentRunComment) {
      if (
        !agentRunCommentNotificationClaim ||
        !agentRunCommentNotificationState
      ) {
        throw new Error("Run activity notification claim is missing");
      }
      if (!agentRunCommentNotificationState.commentMentionsAttemptedAt) {
        const claim = agentRunCommentNotificationClaim;
        mentionProcessing = runMentionProcessing().then(async () => {
          const checkpointed = await prisma.agentRunActivity.updateMany({
            where: {
              id: claim.activityId,
              commentNotificationsProcessingAt: claim.processingAt,
              commentMentionsAttemptedAt: null,
            },
            data: { commentMentionsAttemptedAt: new Date() },
          });
          if (checkpointed.count === 0) {
            throw new Error("Run activity mention notification claim was lost");
          }
        });
      }
    } else {
      mentionProcessing = runMentionProcessing().catch((err) =>
        console.warn("[createCommentService] processMentions failed:", err),
      );
    }

    const notificationWork = [
      // Run-generated comments are not composer submissions, so they must not
      // consume the user's draft.
      isAgentRunComment
        ? Promise.resolve()
        : prisma.drafts.deleteMany({
            where: {
              type: "Comment",
              taskId,
              userId: creatorId,
              updatedAt: { lte: comment.createdAt },
            },
          }),
      createNotificationForComment(dependencies, 
        task,
        comment,
        creatorId,
        recipientUserIds,
        agentId ?? null,
        resolvedDirectReplyUserId,
        Boolean(inboundEmailId || agentRunReplayComment),
      ),
      mentionProcessing,
      processTaskReferences
        ? processTaskReferencesFromCommentText(dependencies, 
            committedText,
            taskId,
            currentUser.id,
          ).catch((err) =>
            console.warn(
              "[createCommentService] processTaskReferences failed:",
              err,
            ),
          )
        : Promise.resolve(),
      prisma.user.findFirst({
        where: { id: creatorId },
      }),
      idsToSendNotificationsTo(taskId, creatorId, task.userId, task.projectId),
    ] as const;
    const [, , , , commentCreator, userIds] = await Promise.all(
      notificationWork,
    ).catch(async (error) => {
      await Promise.allSettled(notificationWork);
      throw error;
    });

    // Publish only after mention notifications exist. Agent replies can then
    // claim the persisted invocation identified by reply_to_comment_id.
    if (isAgentRunComment) await renewNotificationClaim();
    await publishAgentWebhookDeliveries(webhookDeliveryIds);
    if (isAgentRunComment) await renewNotificationClaim();
    await publishBoardWebhookDeliveries(boardWebhookDeliveryIds);
    agentRunCommentNotificationClaim = await deliverCommentNotifications(
      context, agentRunCommentNotificationClaim, agentRunCommentNotificationState,
      notificationDeliveryKeys, renewNotificationClaim, checkpointNotificationDelivery,
      recipientUserIds, mentionedUserIds, commentCreator, userIds,
    );

    return comment;
  } catch (error) {
    if (agentRunCommentNotificationClaim) {
      const claim = agentRunCommentNotificationClaim;
      await prisma.agentRunActivity
        .updateMany({
          where: {
            id: claim.activityId,
            commentNotificationsCompletedAt: null,
            commentNotificationsProcessingAt: claim.processingAt,
          },
          data: { commentNotificationsProcessingAt: null },
        })
        .catch((releaseError) =>
          console.error(
            "[createCommentService] run notification claim release failed:",
            releaseError,
          ),
        );
    }
    if (inboundEmailId && inboundProcessingStartedAt) {
      await releaseInboundEmailProcessing(
        prisma,
        inboundEmailId,
        comment.id,
        inboundProcessingStartedAt,
      ).catch((releaseError) =>
        console.error(
          "[createCommentService] inbound receipt release failed:",
          releaseError,
        ),
      );
    }
    throw error;
  }
}
