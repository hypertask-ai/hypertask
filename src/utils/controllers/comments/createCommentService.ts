/**
 * Shared comment creation logic used by both Pages API and MCP route.
 * Single source of truth for: DB write, notifications, email, mentions, device FCM.
 */
import prisma from "@/lib/prisma";
import idsToSendNotificationsTo from "@/utils/controllers/notifications/IdsToSendNotificationsTo";
import {
  broadcastBoardChange,
  broadcastInboxChange,
  broadcastTaskComment,
} from "@/lib/realtime/server";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import {
  includeSenderInRecipients,
  shouldNotifyTaskOwnerForComment,
} from "@/utils/controllers/notifications/agentActionRecipients";
import scheduleTaskSummaryGeneration from "@/pages/api/queues/FAST/generateSummary";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import { upsertCommentToTurbopuffer } from "@/utils/controllers/turbopuffer/turbopufferHelper";
import {
  getMentionedUserIdsFromCommentText,
  getMentionedAgentIdsFromCommentText,
  processMentionsFromCommentText,
} from "@/utils/controllers/comments/processMentions";
import { extractTaskReferencesFromCommentText } from "@/utils/controllers/comments/extractTaskReferences";
import { addRelatedTasks } from "@/utils/controllers/tasks/addRelatedTasks";
import { sendDataOnlyFcm } from "@/utils/controllers/FCM";
import { shouldNotify } from "@/utils/controllers/notifications/shouldNotify";
import { sendEmailNotification } from "@/utils/controllers/notifications/sendNotification";
import scheduleCommentSummaryGeneration from "@/pages/api/queues/FAST/generateCommentSummary";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { recordHyperAiCommentOrigin } from "@/lib/ai/hyperAiConfirmation";
import {
  persistAgentRunTriggerWebhooks,
  persistAgentTaskRunPromptWebhooks,
  persistAgentWebhookEvent,
  persistAgentWebhookEvents,
  publishAgentWebhookDeliveries,
} from "@/lib/agentWebhooks/outbox";
import {
  persistBoardWebhookEvents,
  publishBoardWebhookDeliveries,
} from "@/lib/mcp/webhooks/outbox";
import type { WebhookDelivery } from "@/lib/mcp/webhooks/events";
import { generalConfig } from "@/lib/configs/general.config";
import { normalizeRichTextStructure } from "@/utils/helperFunctions/normalizeRichTextStructure";
import {
  buildAgentInvocationSelector,
  claimPendingAgentInvocation,
  DirectReplyAlreadyHandledError,
} from "@/utils/controllers/comments/agentInvocationCorrelation";
import {
  claimInboundEmailProcessing,
  completeInboundEmailProcessing,
  findInboundEmailReceipt,
  recordInboundEmailComment,
  releaseInboundEmailProcessing,
  requireInboundEmailComment,
} from "@/utils/controllers/comments/inboundEmailReceipt";
import {
  persistAgentRunActivity,
  persistAgentRunSelection,
  type AgentRunActivityPersistenceInput,
  type AgentRunSelectionPersistenceInput,
} from "@/lib/agentRuns/persistence";
import {
  AgentRunActivityInProgressError,
  serializeAgentRun,
} from "@/lib/agentRuns/model";

const INBOUND_PROCESSING_LEASE_MS = 5 * 60_000;
const AGENT_RUN_COMMENT_NOTIFICATION_LEASE_MS = 5 * 60_000;

export interface CreateCommentParams {
  text: string;
  creatorId: number;
  taskId: number;
  ownerId: number;
  currentUser: {
    id: number;
    email?: string | null;
    displayName?: string | null;
    photoURL?: string | null;
  };
  agentId?: string | null;
  /** Authenticated requester who is waiting for this generated answer. */
  directReplyUserId?: number | null;
  /** Exact invoking comment supplied by an agent webhook/MCP reply. */
  directReplySourceCommentId?: number | null;
  /**
   * Durable invocation token (agent Mentioned notification id) supplied by an
   * agent reply. Description mentions have no source comment, so this is the
   * only correlation they can carry.
   */
  directReplyInvocationId?: number | null;
  // System-authored comments still authorize against the request user.
  accessUserId?: number;
  processTaskReferences?: boolean;
  // Only signature-checked webhooks, authenticated cron work, or a route that
  // already scoped the task to its request user may post as the system bot.
  trustedCaller?: boolean;
  /** Resend's immutable received-email id, used for durable webhook replay safety. */
  inboundEmailId?: string;
  /** Agent response row that must commit with its visible task comment. */
  agentRunActivity?: AgentRunActivityPersistenceInput;
  /** Human elicitation choice that must commit with its visible task comment. */
  agentRunSelection?: AgentRunSelectionPersistenceInput;
  /** Existing run comment and outbox rows whose side effects need resuming. */
  agentRunReplayComment?: {
    id: number;
    activityId: string;
    agentWebhookDeliveryIds: string[];
    boardWebhookDeliveryIds: string[];
    notificationsCompletedAt: Date | null;
  };
  /**
   * Extra board events to persist in the same transaction as the comment, so a
   * caller whose domain change IS this comment (escalation) never has a
   * post-commit emit that a crash could drop (HTPR-4530).
   */
  extraBoardWebhookEvents?: WebhookDelivery[];
}

async function resolveCommentRecipientUserIds(
  task: any,
  creatorId: number,
  ownerId: number,
  fromAgentId?: string | null,
): Promise<number[]> {
  const agentActed = includeSenderInRecipients(fromAgentId);
  const [assignees, followers] = await Promise.all([
    prisma.assignees.findMany({
      where: agentActed
        ? { taskId: task.id, agentId: null }
        : {
            taskId: task.id,
            agentId: null,
            NOT: [{ userId: creatorId }, { userId: ownerId }],
          },
      select: { userId: true },
    }),
    prisma.follower.findMany({
      where: agentActed
        ? { taskId: task.id, agentId: null }
        : {
            taskId: task.id,
            agentId: null,
            NOT: [{ userId: creatorId }, { userId: ownerId }],
          },
      select: { userId: true },
    }),
  ]);

  const recipientUserIds = new Set([
    ...assignees.map(({ userId }) => userId),
    ...followers.map(({ userId }) => userId),
  ]);

  if (shouldNotifyTaskOwnerForComment(creatorId, task.userId, fromAgentId)) {
    recipientUserIds.add(task.userId);
  }

  return [...recipientUserIds];
}

async function createNotificationForComment(
  task: any,
  comment: any,
  creatorId: number,
  recipientUserIds: number[],
  fromAgentId?: string | null,
  directReplyUserId?: number | null,
  dedupeByComment = false,
) {
  for (const recipientUserId of recipientUserIds) {
    // A direct reply gets one addressed Mentioned event below instead of a
    // routine agent Comment event. Its marker bypasses project-level muting.
    if (recipientUserId === directReplyUserId) continue;
    if (
      dedupeByComment &&
      (await prisma.notification.findFirst({
        where: {
          type: "Comment",
          commentId: comment.id,
          userId: recipientUserId,
          agentId: null,
        },
        select: { id: true },
      }))
    ) {
      continue;
    }
    await checkReminderAndCreateNotification(
      recipientUserId,
      task.projectId,
      task.id,
      {
        type: "Comment",
        commentId: comment.id,
        userId: recipientUserId,
        taskId: task.id,
        projectId: task.projectId,
        fromUserId: creatorId,
        ...(fromAgentId ? { fromAgentId } : {}),
      },
    );
  }

  // User → Agent: notify agent assignees (agents have no reminders, create directly)
  const agentAssignees = await prisma.assignees.findMany({
    where: {
      taskId: task.id,
      agentId: { not: null },
      agent: { revokedAt: null },
    },
    include: { agent: { select: { id: true, userId: true } } },
  });

  for (const a of agentAssignees) {
    if (!a.agentId || !a.agent) continue;
    if (
      dedupeByComment &&
      (await prisma.notification.findFirst({
        where: {
          type: "Comment",
          commentId: comment.id,
          agentId: a.agentId,
        },
        select: { id: true },
      }))
    ) {
      continue;
    }
    await prisma.notification.create({
      data: {
        type: "Comment",
        commentId: comment.id,
        agentId: a.agentId,
        userId: a.agent.userId,
        taskId: task.id,
        projectId: task.projectId,
        fromUserId: creatorId,
        ...(fromAgentId ? { fromAgentId } : {}),
      },
    });
    void broadcastInboxChange(a.agent.userId, { originUserId: creatorId });
  }

  // User → Agent: notify agent followers (agent-addressed, keeps the owner's user inbox clean)
  const agentFollowers = await prisma.follower.findMany({
    where: {
      taskId: task.id,
      agentId: { not: null },
      agent: { revokedAt: null },
    },
    include: { agent: { select: { id: true, userId: true } } },
  });

  const notifiedAgentIds = new Set(agentAssignees.map((a) => a.agentId));
  for (const f of agentFollowers) {
    if (!f.agentId || !f.agent || notifiedAgentIds.has(f.agentId)) continue;
    if (
      dedupeByComment &&
      (await prisma.notification.findFirst({
        where: {
          type: "Comment",
          commentId: comment.id,
          agentId: f.agentId,
        },
        select: { id: true },
      }))
    ) {
      continue;
    }
    await prisma.notification.create({
      data: {
        type: "Comment",
        commentId: comment.id,
        agentId: f.agentId,
        userId: f.agent.userId,
        taskId: task.id,
        projectId: task.projectId,
        fromUserId: creatorId,
        ...(fromAgentId ? { fromAgentId } : {}),
      },
    });
  }
}

async function resolveCommentSenderName(
  creatorId: number,
  currentUser: CreateCommentParams["currentUser"],
  fromAgentId?: string | null,
): Promise<string> {
  if (fromAgentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: fromAgentId },
      select: { displayName: true },
    });
    if (agent?.displayName) return agent.displayName;
  }

  if (currentUser.displayName) return currentUser.displayName;

  const creator = await prisma.user.findUnique({
    where: { id: creatorId },
    select: { displayName: true },
  });
  return creator?.displayName || currentUser.email || "Hypertask user";
}

async function sendCommentEmails({
  task,
  text,
  creatorId,
  currentUser,
  recipientUserIds,
  mentionedUserIds,
  fromAgentId,
}: {
  task: any;
  text: string;
  creatorId: number;
  currentUser: CreateCommentParams["currentUser"];
  recipientUserIds: number[];
  mentionedUserIds: Set<number>;
  fromAgentId?: string | null;
}): Promise<void> {
  const emailRecipientIds = recipientUserIds.filter(
    (userId) => !mentionedUserIds.has(userId),
  );
  if (emailRecipientIds.length === 0) return;

  const [senderName, recipients] = await Promise.all([
    resolveCommentSenderName(creatorId, currentUser, fromAgentId),
    prisma.user.findMany({
      where: { id: { in: emailRecipientIds } },
      select: {
        id: true,
        email: true,
        displayName: true,
        UserSetting: { select: { notification: true } },
      },
    }),
  ]);

  const baseUrl =
    process.env.NEXT_PUBLIC_BASEURL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
  const taskLink = `${baseUrl}/detail/project-${task.projectId}/${task.uniqueIndex}`;

  await Promise.all(
    recipients.map(async (recipient) => {
      if (!recipient.email || !recipient.UserSetting?.notification) return;
      // shouldNotify, not the legacy preference helper: only the former reads the
      // per-category matrix, so the old call ignored "comments off" entirely.
      if (!(await shouldNotify(recipient.id, "Comment", "email"))) return;

      await sendEmailNotification("Comment", {
        sender: senderName,
        recipient: recipient.email,
        title: task.title,
        link: taskLink,
        commentText: text,
        userId: recipient.id,
        taskId: task.id,
      });
    }),
  );
}

/**
 * Extracts task references from comment text and creates related task relations.
 * Supports URLs (/detail/project-X/Y) and HTML spans (span[data-label="task"]).
 * Used for MCP/CLI comments and any comment where client-side relation extraction was skipped.
 */
async function processTaskReferencesFromCommentText(
  text: string,
  currentTaskId: number,
  userId: number,
): Promise<void> {
  const refs = extractTaskReferencesFromCommentText(text);
  if (refs.length === 0) return;

  const result = await addRelatedTasks(
    {
      relatedTasks: refs,
      currentTaskId,
    },
    userId,
  );

  if (result.status !== 200) {
    console.warn(
      "[createCommentService] addRelatedTasks returned status:",
      result.status,
    );
  }
}

async function loadAgentRunReplayComment(
  comments: Pick<typeof prisma.comment, "findFirst">,
  input: {
    commentId: number;
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
  const text = normalizeRichTextStructure(inputText);

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
    transactionResult = await prisma.$transaction(async (tx) => {
      if (agentRunReplayComment) {
        return loadAgentRunReplayComment(tx.comment, {
          commentId: agentRunReplayComment.id,
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
      const comment = await tx.comment.create({
        data: {
          text,
          creatorId,
          taskId,
          agentId,
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
      const assignedAgentIds = (
        await tx.assignees.findMany({
          where: { taskId, agentId: { not: null } },
          select: { agentId: true },
        })
      )
        .map(({ agentId: assignedAgentId }) => assignedAgentId)
        .filter((assignedAgentId): assignedAgentId is string =>
          Boolean(assignedAgentId),
        );
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
  } catch (error) {
    if (error instanceof DirectReplyAlreadyHandledError) {
      return prisma.comment.findUniqueOrThrow({
        where: { id: error.commentId },
      });
    }
    throw error;
  }
  const {
    comment,
    webhookDeliveryIds,
    boardWebhookDeliveryIds,
    resolvedDirectReplyUserId,
    inboundCompleted,
    inboundProcessingStartedAt,
  } = transactionResult;
  if (inboundCompleted) return comment;
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
            commentMentionsAttemptedAt: true,
            commentFcmAttemptedAt: true,
            commentEmailsAttemptedAt: true,
          },
        });
    }

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

    const recipientUserIds = await resolveCommentRecipientUserIds(
      task,
      creatorId,
      ownerId,
      agentId ?? null,
    );
    if (resolvedDirectReplyUserId != null) {
      recipientUserIds.push(resolvedDirectReplyUserId);
    }
    const mentionedUserIds = new Set(getMentionedUserIdsFromCommentText(text));
    const runMentionProcessing = () =>
      processMentionsFromCommentText({
        text,
        commentId: comment.id,
        taskId,
        projectId: task.projectId,
        mentionedBy: creatorIdNum,
        fromAgentId: agentId ?? null,
        skipUserIds:
          resolvedDirectReplyUserId === null
            ? []
            : [resolvedDirectReplyUserId],
      }).catch((err) =>
        console.warn("[createCommentService] processMentions failed:", err),
      );
    let mentionProcessing: Promise<void> = Promise.resolve();
    if (isAgentRunComment) {
      if (
        !agentRunCommentNotificationClaim ||
        !agentRunCommentNotificationState
      ) {
        throw new Error("Run activity notification claim is missing");
      }
      if (!agentRunCommentNotificationState.commentMentionsAttemptedAt) {
        const reserved = await prisma.agentRunActivity.updateMany({
          where: {
            id: agentRunCommentNotificationClaim.activityId,
            commentNotificationsProcessingAt:
              agentRunCommentNotificationClaim.processingAt,
            commentMentionsAttemptedAt: null,
          },
          data: { commentMentionsAttemptedAt: new Date() },
        });
        if (reserved.count === 0) {
          throw new Error("Run activity mention notification claim was lost");
        }
        mentionProcessing = runMentionProcessing();
      }
    } else {
      mentionProcessing = runMentionProcessing();
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
      createNotificationForComment(
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
        ? processTaskReferencesFromCommentText(
            text,
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
    const [_, __, ___, ____, commentCreator, userIds] = await Promise.all(
      notificationWork,
    ).catch(async (error) => {
      await Promise.allSettled(notificationWork);
      throw error;
    });

    // Publish only after mention notifications exist. Agent replies can then
    // claim the persisted invocation identified by reply_to_comment_id.
    await publishAgentWebhookDeliveries(webhookDeliveryIds);
    await publishBoardWebhookDeliveries(boardWebhookDeliveryIds);
    if (isAgentRunComment) {
      if (
        !agentRunCommentNotificationClaim ||
        !agentRunCommentNotificationState
      ) {
        throw new Error("Run activity notification claim is missing");
      }
      // ponytail: these channels retain the ordinary comment path's best-effort
      // contract. Reserve one attempt before handoff so a process exit cannot
      // duplicate it; guaranteed delivery needs a provider-idempotent outbox.
      if (!agentRunCommentNotificationState.commentFcmAttemptedAt) {
        const devices = await prisma.subscribedDevices.findMany({
          where: { userId: { in: userIds } },
        });
        const reserved = await prisma.agentRunActivity.updateMany({
          where: {
            id: agentRunCommentNotificationClaim.activityId,
            commentNotificationsProcessingAt:
              agentRunCommentNotificationClaim.processingAt,
            commentFcmAttemptedAt: null,
          },
          data: { commentFcmAttemptedAt: new Date() },
        });
        if (reserved.count === 0) {
          throw new Error("Run activity FCM notification claim was lost");
        }
        await sendDataOnlyFcm(
          devices,
          commentCreator!,
          task.title,
          task.uniqueIndex,
          task.projectId,
          creatorId,
          comment,
        ).catch((error) =>
          console.warn("[createCommentService] FCM delivery failed:", error),
        );
      }
      if (!agentRunCommentNotificationState.commentEmailsAttemptedAt) {
        const reserved = await prisma.agentRunActivity.updateMany({
          where: {
            id: agentRunCommentNotificationClaim.activityId,
            commentNotificationsProcessingAt:
              agentRunCommentNotificationClaim.processingAt,
            commentEmailsAttemptedAt: null,
          },
          data: { commentEmailsAttemptedAt: new Date() },
        });
        if (reserved.count === 0) {
          throw new Error("Run activity email notification claim was lost");
        }
        await sendCommentEmails({
          task,
          text,
          creatorId,
          currentUser,
          recipientUserIds,
          mentionedUserIds,
          fromAgentId: agentId ?? null,
        }).catch((error) =>
          console.warn(
            "[createCommentService] comment email delivery failed:",
            error,
          ),
        );
      }
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
      if (agentRunReplayComment) {
        void broadcastTaskComment(taskId, {
          originUserId: accessUserId ?? currentUser.id,
        });
      }
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
        await sendCommentEmails({
          task,
          text,
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
        await sendCommentEmails({
          task,
          text,
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
