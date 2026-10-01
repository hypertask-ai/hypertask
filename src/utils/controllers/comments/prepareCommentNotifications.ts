import type { CommentFanoutContext } from './commentFanoutTypes';

export async function prepareCommentNotifications(context: CommentFanoutContext) {
  const { dependencies } = context;
  const { broadcastInboxChange, recordHyperAiCommentOrigin, scheduleCommentSummaryGeneration, prisma, broadcastBoardChange, upsertCommentToTurbopuffer, scheduleTaskSummaryGeneration } = dependencies;
  const { task, creatorId, creatorIdNum, taskId, agentId, inboundEmailId, agentRunActivity, agentRunSelection, agentRunReplayComment, hyperAiId } = context;
  const { comment, resolvedDirectReplyUserId } = context.transactionResult;
  if (resolvedDirectReplyUserId != null) {
    void broadcastInboxChange(resolvedDirectReplyUserId, {
      originUserId: creatorId,
    });
  }
  // Approval comments must be immutable creation events. This receipt lets
  // HyperAI reject a comment that was edited into an approval phrase later.
  await recordHyperAiCommentOrigin({
    commentId: comment.id,
    userId: creatorIdNum,
    taskId,
    agentId: agentId ?? null,
    text: comment.text,
    createdAt: comment.createdAt,
  }).catch((error) =>
    console.warn(
      "[createCommentService] HyperAI comment receipt failed:",
      error,
    ),
  );

  const clearsWaitingOn = !agentId && task.waitingOnUserId === creatorIdNum;

  await scheduleCommentSummaryGeneration({ commentId: comment.id }).catch(
    (err) =>
      console.warn(
        "[createCommentService] comment summary schedule failed:",
        err,
      ),
  );

  // Keep totalComments in sync — avoids a COUNT join on every board load.
  // creatorId is always set in this service (unlike activity comments).
  if (
    !inboundEmailId &&
    !agentRunActivity &&
    !agentRunSelection &&
    !agentRunReplayComment
  ) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        totalComments: { increment: 1 },
        lastCommentAt: new Date(),
        ...(creatorIdNum !== hyperAiId &&
        !task.updatedByUserIds?.includes(creatorIdNum)
          ? { updatedByUserIds: { push: creatorIdNum } }
          : {}),
      },
    });
  }
  if (clearsWaitingOn) {
    const cleared = await prisma.task.updateMany({
      where: { id: taskId, waitingOnUserId: creatorIdNum },
      data: {
        waitingOnUserId: null,
        waitingOnSetById: null,
        waitingOnSetAt: null,
      },
    });
    if (cleared.count > 0) {
      void broadcastInboxChange(creatorIdNum, { originUserId: creatorIdNum });
      void broadcastBoardChange(task.projectId, {
        originUserId: creatorIdNum,
      });
    }
  }

  const searchUpsert = upsertCommentToTurbopuffer(comment.id);
  if (inboundEmailId) {
    await searchUpsert;
  } else {
    void searchUpsert.catch((error) =>
      console.warn(
        "[createCommentService] search upsert failed:",
        error,
      ),
    );
  }
  const taskSummary = scheduleTaskSummaryGeneration({
    taskId,
    agentId: agentId ?? null,
  });
  if (inboundEmailId) {
    await taskSummary;
  } else {
    void taskSummary.catch((error) =>
      console.warn(
        "[createCommentService] task summary schedule failed:",
        error,
      ),
    );
  }
}
