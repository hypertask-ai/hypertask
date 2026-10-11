import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7092_DECISIONS_FLAG } from "@/lib/flags/keys";
import { pickDecisionTaskIds, type DecisionMentionComment } from "@/lib/inboxDecisions";

/**
 * HTPR-7092: tasks in this user's inbox that wait on their yes or no. Gated on the
 * server: with the flag off this returns an empty set and the Decisions split never
 * exists. Two queries, whatever the number of rows.
 */
export async function getDecisionTaskIds(
  userId: number,
  inboxWhere: Prisma.NotificationWhereInput,
  isEnabled: (key: string, userId: number) => Promise<boolean> = isFeatureEnabled,
): Promise<Set<number>> {
  if (!(await isEnabled(HTPR_7092_DECISIONS_FLAG, userId).catch(() => false))) return new Set();

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
      comment: { select: { text: true, commentText: true, createdAt: true } },
    },
  });
  const candidates: DecisionMentionComment[] = mentions.flatMap((row) =>
    row.taskId != null && row.comment
      ? [{
          taskId: row.taskId,
          text: row.comment.text,
          commentText: row.comment.commentText,
          createdAt: row.comment.createdAt,
        }]
      : [],
  );
  const taskIds = [...new Set(candidates.map((comment) => comment.taskId))];
  if (!taskIds.length) return new Set();

  const viewerComments = await prisma.comment.findMany({
    where: { creatorId: userId, agentId: null, activity: { equals: Prisma.DbNull }, taskId: { in: taskIds } },
    select: { taskId: true, createdAt: true },
  });
  return pickDecisionTaskIds(candidates, viewerComments);
}
