import type { CommentDependencies } from './commentCreationTypes';
import type { CreateCommentParams } from './commentCreationTypes';
import { isAgentCommentFanoutFixOn } from './agentCommentFanout';
import { isQuietOwnerInboxOn } from '@/utils/controllers/notifications/quietOwnerInbox';

export async function resolveCommentRecipientUserIds(
  dependencies: CommentDependencies,
  task: any,
  creatorId: number,
  ownerId: number,
  fromAgentId?: string | null,
  commentText?: string,
): Promise<number[]> {
  const { includeSenderInRecipients, prisma, shouldNotifyTaskOwnerForComment } = dependencies;
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

  // HTPR-7096: an agent comment carries its owner as creatorId. With the flag on,
  // the owner hears from their own agent only through an @mention (the mention
  // path notifies then) or an explicit direct reply (added by the caller after
  // this). Applied after every recipient source, so assignee and follower rows
  // cannot bring the chatter back.
  if (
    fromAgentId &&
    recipientUserIds.has(creatorId) &&
    !dependencies.getMentionedUserIdsFromCommentText(commentText ?? "").includes(creatorId) &&
    (await isQuietOwnerInboxOn(creatorId))
  ) {
    recipientUserIds.delete(creatorId);
  }

  return [...recipientUserIds];
}

export async function createNotificationForComment(
  dependencies: CommentDependencies,
  task: any,
  comment: any,
  creatorId: number,
  recipientUserIds: number[],
  fromAgentId?: string | null,
  directReplyUserId?: number | null,
  dedupeByComment = false,
) {
  const { prisma, checkRemindersAndCreateNotifications, broadcastInboxChange } = dependencies;
  // A direct reply gets one addressed Mentioned event below instead of a
  // routine agent Comment event. Its marker bypasses project-level muting.
  let humanUserIds = recipientUserIds.filter(
    (recipientUserId) => recipientUserId !== directReplyUserId,
  );
  if (dedupeByComment && humanUserIds.length > 0) {
    const delivered = await prisma.notification.findMany({
      where: {
        type: "Comment",
        commentId: comment.id,
        userId: { in: humanUserIds },
        agentId: null,
      },
      select: { userId: true },
    });
    const deliveredUserIds = new Set(delivered.map(({ userId }) => userId));
    humanUserIds = humanUserIds.filter((userId) => !deliveredUserIds.has(userId));
  }
  await checkRemindersAndCreateNotifications(
    humanUserIds,
    task.projectId,
    task.id,
    {
      type: "Comment",
      commentId: comment.id,
      taskId: task.id,
      projectId: task.projectId,
      fromUserId: creatorId,
      ...(fromAgentId ? { fromAgentId } : {}),
    },
  );

  // User → Agent: notify agent assignees and followers (agents have no
  // reminders, create directly; follower rows keep the owner's user inbox clean)
  const agentWhere = {
    taskId: task.id,
    agentId: { not: null },
    agent: { revokedAt: null },
  };
  const agentInclude = { agent: { select: { id: true, userId: true } } };
  const [agentAssignees, agentFollowers] = await Promise.all([
    prisma.assignees.findMany({ where: agentWhere, include: agentInclude }),
    prisma.follower.findMany({ where: agentWhere, include: agentInclude }),
  ]);

  // HTPR-7088: an agent never gets an inbox row for its own comment, and
  // follower agents get the same live inbox update as assigned agents.
  if (agentAssignees.length + agentFollowers.length === 0) return;
  const fanoutFixOn = await isAgentCommentFanoutFixOn(creatorId);
  const isOwnComment = (agentId: string | null) =>
    fanoutFixOn && Boolean(fromAgentId) && agentId === fromAgentId;
  const notifiedAgentIds = new Set(agentAssignees.map((a) => a.agentId));
  const assigneeAgents = agentAssignees.flatMap((a) =>
    a.agentId && a.agent && !isOwnComment(a.agentId)
      ? [{ agentId: a.agentId, userId: a.agent.userId }]
      : [],
  );
  const followerAgents = agentFollowers.flatMap((f) =>
    f.agentId && f.agent && !notifiedAgentIds.has(f.agentId) && !isOwnComment(f.agentId)
      ? [{ agentId: f.agentId, userId: f.agent.userId }]
      : [],
  );
  let deliveredAgentIds = new Set<string | null>();
  if (dedupeByComment && assigneeAgents.length + followerAgents.length > 0) {
    const delivered = await prisma.notification.findMany({
      where: {
        type: "Comment",
        commentId: comment.id,
        agentId: {
          in: [...assigneeAgents, ...followerAgents].map((a) => a.agentId),
        },
      },
      select: { agentId: true },
    });
    deliveredAgentIds = new Set(delivered.map(({ agentId }) => agentId));
  }
  // On replay, a row queued earlier in this batch counts as delivered, as it
  // did when each row was checked right after the previous insert.
  const isNew = ({ agentId }: { agentId: string }) => {
    if (deliveredAgentIds.has(agentId)) return false;
    if (dedupeByComment) deliveredAgentIds.add(agentId);
    return true;
  };
  const newAssigneeAgents = assigneeAgents.filter(isNew);
  const newAgents = [...newAssigneeAgents, ...followerAgents.filter(isNew)];
  if (newAgents.length === 0) return;

  await prisma.notification.createMany({
    data: newAgents.map(({ agentId, userId }) => ({
      type: "Comment",
      commentId: comment.id,
      agentId,
      userId,
      taskId: task.id,
      projectId: task.projectId,
      fromUserId: creatorId,
      ...(fromAgentId ? { fromAgentId } : {}),
    })),
  });
  for (const a of fanoutFixOn ? newAgents : newAssigneeAgents) {
    void broadcastInboxChange(a.userId, { originUserId: creatorId });
  }
}

async function resolveCommentSenderName(
  dependencies: CommentDependencies,
  creatorId: number,
  currentUser: CreateCommentParams["currentUser"],
  fromAgentId?: string | null,
): Promise<string> {
  const { prisma } = dependencies;
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

export async function sendCommentEmails(
  dependencies: CommentDependencies,
  {
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
  const { prisma, shouldNotify, sendEmailNotification } = dependencies;
  const emailRecipientIds = recipientUserIds.filter(
    (userId) => !mentionedUserIds.has(userId),
  );
  if (emailRecipientIds.length === 0) return;

  const [senderName, recipients] = await Promise.all([
    resolveCommentSenderName(dependencies, creatorId, currentUser, fromAgentId),
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

/**
 * Extracts task references from comment text and creates related task relations.
 * Supports URLs (/detail/project-X/Y) and HTML spans (span[data-label="task"]).
 * Used for MCP/CLI comments and any comment where client-side relation extraction was skipped.
 */
export async function processTaskReferencesFromCommentText(
  dependencies: CommentDependencies,
  text: string,
  currentTaskId: number,
  userId: number,
): Promise<void> {
  const { extractTaskReferencesFromCommentText, addRelatedTasks } = dependencies;
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
