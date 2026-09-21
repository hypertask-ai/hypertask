import prisma from "@/lib/prisma";
import { broadcastInboxChange } from "@/lib/realtime/server";
import checkReminderAndCreateNotification from "@/utils/controllers/notifications/creation-service/check-reminder_create-notification";
import { includeSenderInRecipients, shouldNotifyTaskOwnerForComment } from "@/utils/controllers/notifications/agentActionRecipients";
import { shouldNotify } from "@/utils/controllers/notifications/shouldNotify";
import { sendEmailNotification } from "@/utils/controllers/notifications/sendNotification";
import type { WebhookDelivery } from "@/lib/mcp/webhooks/events";
import { type AgentRunActivityPersistenceInput, type AgentRunSelectionPersistenceInput } from "@/lib/agentRuns/persistence";

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

export async function resolveCommentRecipientUserIds(
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

export async function createNotificationForComment(
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

export async function resolveCommentSenderName(
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

export async function sendCommentEmails({
  task,
  text,
  creatorId,
  currentUser,
  recipientUserIds,
  mentionedUserIds,
  fromAgentId,
  deliveredUserIds,
  beforeDelivery,
  markDelivered,
}: {
  task: any;
  text: string;
  creatorId: number;
  currentUser: CreateCommentParams["currentUser"];
  recipientUserIds: number[];
  mentionedUserIds: Set<number>;
  fromAgentId?: string | null;
  deliveredUserIds?: ReadonlySet<number>;
  beforeDelivery?: () => Promise<void>;
  markDelivered?: (userId: number) => Promise<void>;
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

  const sendToRecipient = async (recipient: (typeof recipients)[number]) => {
    if (deliveredUserIds?.has(recipient.id)) return;
    if (recipient.email && recipient.UserSetting?.notification) {
      // shouldNotify, not the legacy preference helper: only the former reads the
      // per-category matrix, so the old call ignored "comments off" entirely.
      if (await shouldNotify(recipient.id, "Comment", "email")) {
        await beforeDelivery?.();
        const sent = await sendEmailNotification("Comment", {
          sender: senderName,
          recipient: recipient.email,
          title: task.title,
          link: taskLink,
          commentText: text,
          userId: recipient.id,
          taskId: task.id,
        });
        if (!sent) throw new Error("Comment email delivery failed");
      }
    }
    await markDelivered?.(recipient.id);
  };

  if (markDelivered) {
    for (const recipient of recipients) await sendToRecipient(recipient);
  } else {
    await Promise.all(recipients.map(sendToRecipient));
  }
}
