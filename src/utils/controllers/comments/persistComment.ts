import type { CommentDependencies } from './commentCreationTypes';
import type { WebhookDelivery } from "@/lib/mcp/webhooks/events";
import type { CreateCommentParams } from './commentCreationTypes';
import { findCommentWebhookAgentIds, isAgentCommentFanoutFixOn } from './agentCommentFanout';

const INBOUND_PROCESSING_LEASE_MS = 5 * 60_000;

async function loadAgentRunReplayComment(
  comments: Pick<CommentDependencies['prisma']['comment'], "findFirst">,
  input: {
    commentId: number;
    activityId: string;
    taskId: number;
    creatorId: number;
    agentId?: string | null;
    agentWebhookDeliveryIds: string[];
    boardWebhookDeliveryIds: string[];
  },
) {
  const comment = await comments.findFirst({
    where: {
      id: input.commentId,
      taskId: input.taskId,
      creatorId: input.creatorId,
      agentId: input.agentId ?? null,
      OR: [
        { agentRunResponseActivity: { is: { id: input.activityId } } },
        { agentRunSelectionActivity: { is: { id: input.activityId } } },
      ],
    },
  });
  if (!comment) throw new Error("Run activity comment not found");
  return {
    comment,
    webhookDeliveryIds: input.agentWebhookDeliveryIds,
    boardWebhookDeliveryIds: input.boardWebhookDeliveryIds,
    resolvedDirectReplyUserId: null,
    inboundCompleted: false,
    inboundProcessingStartedAt: null,
  };
}

export async function persistComment(
  dependencies: CommentDependencies,
  params: CreateCommentParams,
  text: string,
  creatorIdNum: number,
  hyperAiId: number,
  mentionedAgentIds: string[],
) {
  const { prisma, taskWriteAccessWhere, findInboundEmailReceipt, requireInboundEmailComment, claimInboundEmailProcessing, persistAgentRunActivity, persistAgentRunSelection, recordInboundEmailComment, claimPendingAgentInvocation, persistBoardWebhookEvents, persistAgentWebhookEvents, persistAgentTaskRunPromptWebhooks, persistAgentWebhookEvent, serializeAgentRun, persistAgentRunTriggerWebhooks } = dependencies;
  const {
    creatorId,
    taskId,
    ownerId,
    currentUser,
    agentId,
    directReplyUserId,
    directReplySourceCommentId,
    directReplyInvocationId,
    accessUserId,
    processTaskReferences = true,
    trustedCaller = false,
    inboundEmailId,
    agentRunActivity,
    agentRunSelection,
    agentRunReplayComment,
    extraBoardWebhookEvents = [],
  } = params;
  return prisma.$transaction(async (tx) => {
    if (agentRunReplayComment) {
      return loadAgentRunReplayComment(tx.comment, {
        commentId: agentRunReplayComment.id,
        activityId: agentRunReplayComment.activityId,
        taskId,
        creatorId,
        agentId,
        agentWebhookDeliveryIds:
          agentRunReplayComment.agentWebhookDeliveryIds,
        boardWebhookDeliveryIds:
          agentRunReplayComment.boardWebhookDeliveryIds,
      });
    }
      const lockedTask = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT "id"
        FROM "Task"
        WHERE "id" = ${taskId}
        FOR UPDATE
      `;
    if (lockedTask.length === 0) {
      throw new Error("Task not found or access denied");
    }
    const currentTask = await tx.task.findFirst({
      where: {
        id: taskId,
        ...(trustedCaller
          ? {}
          : {
              project: taskWriteAccessWhere(
                accessUserId ?? currentUser.id,
                agentId,
              ),
            }),
      },
      select: {
        id: true,
        ticketNumber: true,
        projectId: true,
        title: true,
        updatedByUserIds: true,
      },
    });
    if (!currentTask) {
      throw new Error("Task not found or access denied");
    }
    if (inboundEmailId) {
      const receipt = await findInboundEmailReceipt(
        tx,
        inboundEmailId,
        taskId,
      );
      if (receipt) {
        const receiptComment = requireInboundEmailComment(receipt);
        if (receipt.completedAt) {
          return {
            comment: receiptComment,
            webhookDeliveryIds: [],
            boardWebhookDeliveryIds: [],
            resolvedDirectReplyUserId: null,
            inboundCompleted: true,
            inboundProcessingStartedAt: null,
          };
        }
        const processingStartedAt = new Date();
        await claimInboundEmailProcessing(
          tx,
          inboundEmailId,
          receiptComment.id,
          processingStartedAt,
          new Date(
            processingStartedAt.getTime() - INBOUND_PROCESSING_LEASE_MS,
          ),
        );
        return {
          comment: receiptComment,
          webhookDeliveryIds: [],
          boardWebhookDeliveryIds: [],
          resolvedDirectReplyUserId: null,
          inboundCompleted: false,
          inboundProcessingStartedAt: processingStartedAt,
        };
      }
    }
    if (agentRunActivity) {
      await persistAgentRunActivity(tx, agentRunActivity);
    }
    const selectedRun = agentRunSelection
      ? await persistAgentRunSelection(tx, agentRunSelection)
      : null;
    const actingAgentName = agentId
      ? (
          await tx.agent.findUnique({
            where: { id: agentId },
            select: { displayName: true },
          })
        )?.displayName ?? null
      : null;
    const comment = await tx.comment.create({
      data: {
        text,
        creatorId,
        taskId,
        agentId,
        ...(actingAgentName ? { agentDisplayName: actingAgentName } : {}),
      },
    });
    let inboundProcessingStartedAt: Date | null = null;
    if (inboundEmailId) {
      inboundProcessingStartedAt = new Date();
      await recordInboundEmailComment(
        tx,
        inboundEmailId,
        taskId,
        comment.id,
        inboundProcessingStartedAt,
      );
    }
    if (inboundEmailId || agentRunActivity || agentRunSelection) {
      await tx.task.update({
        where: { id: taskId },
        data: {
          totalComments: { increment: 1 },
          lastCommentAt: new Date(),
          ...(agentRunActivity || agentRunSelection
            ? { updatedAt: new Date() }
            : {}),
          ...(creatorIdNum !== hyperAiId &&
          !currentTask.updatedByUserIds.includes(creatorIdNum)
            ? { updatedByUserIds: { push: creatorIdNum } }
            : {}),
        },
      });
    }
    const resolvedDirectReplyUserId =
      directReplyUserId ??
      (agentId
        ? await claimPendingAgentInvocation({
            notifications: tx.notification,
            taskId,
            agentId,
            replyCommentId: comment.id,
            hyperAiId,
            sourceCommentId: directReplySourceCommentId,
            invocationId: directReplyInvocationId,
          })
        : null);
    if (resolvedDirectReplyUserId != null) {
      // A direct answer wakes a snoozed task and persists its Important row in
      // the same transaction as the reply/claim. A failed write rolls all three
      // back, so retries cannot lose the notification behind comment dedupe.
      const awakenedReminders = await tx.reminder.updateMany({
        where: {
          userId: resolvedDirectReplyUserId,
          taskId,
          projectId: currentTask.projectId,
          status: "Normal",
        },
        data: { status: "Archive", updatedAt: new Date() },
      });
      await tx.notification.create({
        data: {
          type: "Mentioned",
          directReply: true,
          commentId: comment.id,
          userId: resolvedDirectReplyUserId,
          taskId,
          projectId: currentTask.projectId,
          fromUserId: creatorId,
          returnedFromReminders: awakenedReminders.count > 0,
          ...(agentId ? { fromAgentId: agentId } : {}),
        },
      });
    }
    let actorDisplayName = currentUser.displayName?.trim() || "";
    if (agentId) {
      const actorAgent = await tx.agent.findUnique({
        where: { id: agentId },
        select: { displayName: true },
      });
      actorDisplayName = actorAgent?.displayName?.trim() || actorDisplayName;
    } else if (!actorDisplayName) {
      const actorUser = await tx.user.findUnique({
        where: { id: creatorId },
        select: { displayName: true },
      });
      actorDisplayName = actorUser?.displayName?.trim() || "Hypertask user";
    }

    const webhookDeliveryIds: Array<string | null> = [];
    // Board-wide subscribers get comment.created in the same transaction, so
    // a comment that commits always has its outbox row (HTPR-4530).
    // Use only this locked, current task snapshot for webhook scope. The
    // pre-transaction task read may belong to the task's previous board.
    const commentCreatedEvent: WebhookDelivery = {
      event: "comment.created",
      data: {
        task: {
          id: taskId,
          ticketNumber: currentTask.ticketNumber,
          projectId: currentTask.projectId,
          title: currentTask.title,
        },
        comment: {
          id: comment.id,
          text: comment.text,
          createdAt: comment.createdAt.toISOString(),
        },
        actor: { userId: creatorIdNum, agentId: agentId ?? null },
      },
    };
    const boardEvents: WebhookDelivery[] = [
      commentCreatedEvent,
      ...extraBoardWebhookEvents,
    ];
    if (mentionedAgentIds.length > 0) {
      boardEvents.push({
        event: "comment.mention",
        data: {
          ...commentCreatedEvent.data,
          mentions: { agentIds: [...new Set(mentionedAgentIds)] },
        },
      });
    }
    const boardWebhookDeliveryIds = await persistBoardWebhookEvents(
      tx,
      currentTask.projectId,
      boardEvents,
    );
    const assignedAgentIds = await findCommentWebhookAgentIds(tx, {
      taskId,
      authorAgentId: agentId,
      fixOn: await isAgentCommentFanoutFixOn(creatorIdNum),
    });
    // Target assigned agents directly. This is not a board broadcast, so an
    // assigned agent receives one comment.created delivery per comment.
    webhookDeliveryIds.push(
      ...(await persistAgentWebhookEvents(tx, {
        event: "comment.created",
        agentIds: assignedAgentIds,
        projectId: currentTask.projectId,
        taskId,
        ticketNumber: currentTask.ticketNumber,
        taskTitle: currentTask.title,
        commentId: comment.id,
        commentHtml: comment.text,
        actor: {
          userId: creatorId,
          agentId: agentId ?? null,
          displayName: actorDisplayName || "Hypertask user",
        },
        broadcast: false,
      })),
    );
    const agentWebhookActor = {
      userId: creatorId,
      agentId: agentId ?? null,
      displayName: actorDisplayName || "Hypertask user",
    };
    // Only human comments continue active runs. Agent-authored replies must
    // not wake the same agent and create a webhook feedback loop.
    if (!agentId) {
      webhookDeliveryIds.push(
        ...(await persistAgentTaskRunPromptWebhooks(tx, {
          projectId: currentTask.projectId,
          taskId,
          ticketNumber: currentTask.ticketNumber,
          taskTitle: currentTask.title,
          commentId: comment.id,
          commentHtml: text,
          actor: agentWebhookActor,
          excludeAgentIds: [
            ...mentionedAgentIds,
            ...(agentRunSelection ? [agentRunSelection.agentId] : []),
          ],
        })),
      );
    }
    if (agentRunSelection && selectedRun) {
      const selectionDeliveryId = await persistAgentWebhookEvent(tx, {
        event: "run.prompted",
        agentId: agentRunSelection.agentId,
        projectId: currentTask.projectId,
        taskId,
        ticketNumber: currentTask.ticketNumber,
        taskTitle: currentTask.title,
        commentId: comment.id,
        commentHtml: text,
        actor: agentWebhookActor,
        runId: selectedRun.id,
        run: serializeAgentRun(selectedRun),
        prompt: text,
        signal: "select",
        selection: {
          activityId: agentRunSelection.activityId,
          value: agentRunSelection.option.value,
          label: agentRunSelection.option.label,
        },
      });
      if (selectionDeliveryId) webhookDeliveryIds.push(selectionDeliveryId);
    }
    for (const mentionedAgentId of mentionedAgentIds) {
      if (
        mentionedAgentId === agentId ||
        mentionedAgentId === agentRunSelection?.agentId
      ) {
        continue;
      }
      webhookDeliveryIds.push(
        ...(await persistAgentRunTriggerWebhooks(tx, {
          event: "comment.mention",
          agentId: mentionedAgentId,
          projectId: currentTask.projectId,
          taskId,
          ticketNumber: currentTask.ticketNumber,
          taskTitle: currentTask.title,
          commentId: comment.id,
          commentHtml: text,
          actor: agentWebhookActor,
        })),
      );
    }
    const commentActivityId =
      agentRunActivity?.id ?? agentRunSelection?.activityId;
    if (commentActivityId) {
      await tx.agentRunActivity.update({
        where: { id: commentActivityId },
        data: {
          ...(agentRunActivity
            ? { responseCommentId: comment.id }
            : { selectionCommentId: comment.id }),
          commentAgentWebhookDeliveryIds: webhookDeliveryIds.filter(
            (id): id is string => Boolean(id),
          ),
          commentBoardWebhookDeliveryIds: boardWebhookDeliveryIds,
        },
      });
    }
    return {
      comment,
      webhookDeliveryIds,
      boardWebhookDeliveryIds,
      resolvedDirectReplyUserId,
      inboundCompleted: false,
      inboundProcessingStartedAt,
    };
  });
}
