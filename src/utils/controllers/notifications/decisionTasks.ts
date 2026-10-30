import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7092_DECISIONS_FLAG } from "@/lib/flags/keys";
import { HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG } from "@/lib/flags/definitions/htpr-8205-agent-clear-blocker";
import { pickDecisionComments, type DecisionMentionComment } from "@/lib/inboxDecisions";

export async function getDecisionComments(
  userId: number,
  inboxWhere: Prisma.NotificationWhereInput,
  isEnabled: (key: string, userId: number) => Promise<boolean> = isFeatureEnabled,
): Promise<Map<number, DecisionMentionComment>> {
  if (!(await isEnabled(HTPR_7092_DECISIONS_FLAG, userId).catch(() => false))) return new Map();

  const mentions = await prisma.notification.findMany({
    where: {
      ...inboxWhere,
      type: "Mentioned",
      taskId: { not: null },
      commentId: { not: null },
      comment: {
        is: {
          OR: [
            { commentText: { contains: "question:", mode: "insensitive" } },
            { text: { contains: "question", mode: "insensitive" } },
          ],
        },
      },
    },
    select: {
      taskId: true,
      commentId: true,
      comment: { select: { text: true, commentText: true, createdAt: true } },
    },
  });
  const candidates: DecisionMentionComment[] = mentions.flatMap((row) =>
    row.taskId != null && row.commentId != null && row.comment
      ? [{
          taskId: row.taskId,
          commentId: row.commentId,
          text: row.comment.text,
          commentText: row.comment.commentText,
          createdAt: row.comment.createdAt,
        }]
      : [],
  );
  const taskIds = [...new Set(candidates.map((comment) => comment.taskId))];
  if (!taskIds.length) return new Map();

  const viewerComments = await prisma.comment.findMany({
    where: { creatorId: userId, agentId: null, activity: { equals: Prisma.DbNull }, taskId: { in: taskIds } },
    select: { taskId: true, createdAt: true },
  });
  const blockerClears = await isFeatureEnabled(HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG, userId).catch(() => false)
    ? await prisma.comment.findMany({
        where: {
          taskId: { in: taskIds },
          activity: { path: ["data", "blockerCleared"], equals: true },
        },
        select: { taskId: true, createdAt: true },
      })
    : [];
  return pickDecisionComments(candidates, viewerComments, blockerClears);
}
