/**
 * Shared comment creation logic used by both Pages API and MCP route.
 * Single source of truth for: DB write, notifications, email, mentions, device FCM.
 */
import prisma from "@/lib/prisma";
import idsToSendNotificationsTo from "@/utils/controllers/notifications/IdsToSendNotificationsTo";
import { broadcastBoardChange, broadcastInboxChange, broadcastTaskComment } from "@/lib/realtime/server";
import { checkRemindersAndCreateNotifications } from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { includeSenderInRecipients, shouldNotifyTaskOwnerForComment } from "@/utils/controllers/notifications/agentActionRecipients";
import scheduleTaskSummaryGeneration from "@/pages/api/queues/FAST/generateSummary";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { upsertCommentToTurbopuffer } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import { getMentionedUserIdsFromCommentText, getMentionedAgentIdsFromCommentText, processMentionsFromCommentText } from "@/utils/controllers/comments/processMentions";
import { extractTaskReferencesFromCommentText } from "@/utils/controllers/comments/extractTaskReferences";
import { addRelatedTasks } from "@/utils/controllers/tasks/addRelatedTasks";
import { sendDataOnlyFcm } from "@/utils/controllers/FCM";
import { shouldNotify } from "@/utils/controllers/notifications/shouldNotify";
import { sendEmailNotification } from "@/utils/controllers/notifications/sendNotification";
import scheduleCommentSummaryGeneration from "@/pages/api/queues/FAST/generateCommentSummary";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { recordHyperAiCommentOrigin } from "@/lib/ai/hyperAiConfirmation";
import { persistAgentRunTriggerWebhooks, persistAgentTaskRunPromptWebhooks, persistAgentWebhookEvent, persistAgentWebhookEvents, publishAgentWebhookDeliveries } from "@/lib/agentWebhooks/outbox";
import { persistBoardWebhookEvents, publishBoardWebhookDeliveries } from "@/lib/mcp/webhooks/outbox";
import { generalConfig } from "@/lib/configs/general.config";
import { normalizeBlockHtml } from "@/lib/mcp/normalizeBlockHtml";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6561_DESCRIPTION_STRUCTURE_FLAG } from "@/lib/flags/keys";
import { normalizeRichTextStructure } from "@/utils/helperFunctions/normalizeRichTextStructure";
import { buildAgentInvocationSelector, claimPendingAgentInvocation, DirectReplyAlreadyHandledError } from "@/utils/controllers/comments/agentInvocationCorrelation";
import { claimInboundEmailProcessing, completeInboundEmailProcessing, findInboundEmailReceipt, recordInboundEmailComment, releaseInboundEmailProcessing, requireInboundEmailComment } from "@/utils/controllers/comments/inboundEmailReceipt";
import { persistAgentRunActivity, persistAgentRunSelection } from "@/lib/agentRuns/persistence";
import { AgentRunActivityInProgressError, serializeAgentRun } from "@/lib/agentRuns/model";
import { persistComment } from './persistComment';
import { fanOutCommentNotifications } from './commentFanout';
import type { CommentDependencies, CreateCommentParams } from './commentCreationTypes';
export type { CreateCommentParams } from './commentCreationTypes';
import { createNotificationForComment as createCommentNotification } from './commentNotifications';

const commentDependencies: CommentDependencies = {
  prisma,
  idsToSendNotificationsTo,
  broadcastBoardChange,
  broadcastInboxChange,
  broadcastTaskComment,
  checkRemindersAndCreateNotifications,
  includeSenderInRecipients,
  shouldNotifyTaskOwnerForComment,
  scheduleTaskSummaryGeneration,
  upsertCommentToTurbopuffer,
  getMentionedUserIdsFromCommentText,
  processMentionsFromCommentText,
  extractTaskReferencesFromCommentText,
  addRelatedTasks,
  sendDataOnlyFcm,
  shouldNotify,
  sendEmailNotification,
  scheduleCommentSummaryGeneration,
  taskWriteAccessWhere,
  recordHyperAiCommentOrigin,
  persistAgentRunTriggerWebhooks,
  persistAgentTaskRunPromptWebhooks,
  persistAgentWebhookEvent,
  persistAgentWebhookEvents,
  publishAgentWebhookDeliveries,
  persistBoardWebhookEvents,
  publishBoardWebhookDeliveries,
  claimPendingAgentInvocation,
  claimInboundEmailProcessing,
  completeInboundEmailProcessing,
  findInboundEmailReceipt,
  recordInboundEmailComment,
  releaseInboundEmailProcessing,
  requireInboundEmailComment,
  persistAgentRunActivity,
  persistAgentRunSelection,
  AgentRunActivityInProgressError,
  serializeAgentRun
};

export async function createNotificationForComment(
  task: any,
  comment: any,
  creatorId: number,
  recipientUserIds: number[],
  fromAgentId?: string | null,
  directReplyUserId?: number | null,
  dedupeByComment = false,
) {
  return createCommentNotification(commentDependencies, task, comment, creatorId, recipientUserIds, fromAgentId, directReplyUserId, dedupeByComment);
}

/**
 * Creates a comment with full side effects: notifications, mentions, FCM.
 * Returns the created comment.
 */
export async function createCommentService(params: CreateCommentParams) {
  const {
    text: inputText,
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
  if (agentRunActivity && agentRunSelection) {
    throw new Error("A comment cannot create and select an agent activity together");
  }
  if (agentRunReplayComment && (agentRunActivity || agentRunSelection)) {
    throw new Error("A run comment replay cannot persist an activity");
  }
  if (
    agentRunActivity &&
    (agentRunActivity.context.taskId !== taskId ||
      agentRunActivity.agentId !== agentId)
  ) {
    throw new Error("Agent activity does not match this task comment");
  }
  if (
    agentRunSelection &&
    (agentRunSelection.context.taskId !== taskId ||
      agentRunSelection.selectedById !== Number(creatorId))
  ) {
    throw new Error("Agent selection does not match this task comment");
  }
  const normalizePlainText = await isFeatureEnabled(
    HTPR_6561_DESCRIPTION_STRUCTURE_FLAG,
    accessUserId ?? currentUser.id
  );
  const text = normalizePlainText
    ? normalizeBlockHtml(inputText)
    : normalizeRichTextStructure(inputText);

  const task = await prisma.task.findFirst({
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
    include: {
      project: {
        include: {
          team: true,
          owner: { include: { devices: true } },
        },
      },
    },
  });

  if (!task) {
    throw new Error("Task not found or access denied");
  }

  const existingInboundReceipt = inboundEmailId
    ? await findInboundEmailReceipt(prisma, inboundEmailId, taskId)
    : null;
  if (existingInboundReceipt) {
    const existingComment = requireInboundEmailComment(existingInboundReceipt);
    if (existingInboundReceipt.completedAt) return existingComment;
  }

  // HTPR-4084: idempotency guard. Several clients can fire the same create twice a
  // second or two apart (task-detail composer virtualizer remount, network retry,
  // Enter double-fire), landing two identical rows. PR #1396's client-side guard only
  // covered one path. This is the single service every path routes through, so dedupe
  // here and no client can double-post. On a hit, return the first comment: the second
  // call succeeds with no new row and no duplicate notifications/FCM/summary.
  // ponytail: read-check window, not a DB unique index. Catches the observed sequential
  // double-fire (~1.7s apart); a truly simultaneous race could still slip two rows past
  // it. Upgrade path if that ever shows up: a @@unique on (taskId, creatorId, text hash).
  const DEDUP_WINDOW_MS = 10_000;
  // Explicit agent answers use the source invocation as their idempotency key.
  // Text dedupe would collapse two distinct requests both answered with "Done".
  const invocationSelector = buildAgentInvocationSelector({
    sourceCommentId: directReplySourceCommentId,
    invocationId: directReplyInvocationId,
  });
  const hasInvocationCorrelation = invocationSelector !== null;
  const handledInvocation =
    agentId && invocationSelector
      ? await prisma.notification.findFirst({
          where: {
            taskId,
            agentId,
            type: "Mentioned",
            ...invocationSelector,
            agentReplyCommentId: { not: null },
          },
          select: { agentReplyCommentId: true },
        })
      : null;
  if (handledInvocation?.agentReplyCommentId != null) {
    return prisma.comment.findUniqueOrThrow({
      where: { id: handledInvocation.agentReplyCommentId },
    });
  }
  const duplicate =
    !hasInvocationCorrelation &&
    !inboundEmailId &&
    !agentRunActivity &&
    !agentRunSelection &&
    !agentRunReplayComment
      ? await prisma.comment.findFirst({
          where: {
            taskId,
            creatorId,
            agentId: agentId ?? null,
            text,
            createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
          },
          orderBy: { createdAt: "desc" },
        })
      : null;
  if (duplicate) {
    return duplicate;
  }

  // A replay must resume the original comment's unfinished work without
  // updating the task a second time.
  if (
    !existingInboundReceipt &&
    !agentRunActivity &&
    !agentRunSelection &&
    !agentRunReplayComment
  ) {
    // Access was established above before the duplicate lookup or any write.
    await updateTaskSingle(
      { id: task.id, updatedAt: new Date() },
      currentUser as any,
      agentId,
      { trustedCaller: true },
    );
  }

  const creatorIdNum = Number(creatorId);
  const hyperAiId = parseInt(
    process.env.NEXT_PUBLIC_HYPERAI_ID || String(generalConfig.hyperAiId),
    10,
  );

  const mentionedAgentIds = getMentionedAgentIdsFromCommentText(text);
  let transactionResult;
  try {
    transactionResult = await persistComment(commentDependencies, params, text, creatorIdNum, hyperAiId, mentionedAgentIds);
  } catch (error) {
    if (error instanceof DirectReplyAlreadyHandledError) {
      return prisma.comment.findUniqueOrThrow({
        where: { id: error.commentId },
      });
    }
    throw error;
  }
  return fanOutCommentNotifications({
    ...params, task, creatorIdNum, hyperAiId, transactionResult, dependencies: commentDependencies,
  });
}
