import { Prisma } from "@prisma/client";
import { visibleUserInboxWhere } from "@/utils/controllers/notifications/visibleInboxScope";
import { eventKeepsImportant, isQuietAgentMention } from "@/lib/inboxQuietAgents";
import { HTPR_7096_QUIET_OWNER_INBOX_FLAG } from "@/lib/flags/definitions/htpr-7096-quiet-owner-inbox";

/** HTPR-7096 flag, keyed on the inbox owner. Loaded lazily so strict module stubs stay untouched. */
export async function isQuietOwnerInboxOn(ownerUserId: number): Promise<boolean> {
  const { isFeatureEnabled } = await import("@/lib/flags");
  return isFeatureEnabled(HTPR_7096_QUIET_OWNER_INBOX_FLAG, ownerUserId);
}

type QuietCandidate = {
  type: string;
  taskId: number | null;
  fromAgentId?: string | null;
  comment?: { text?: string | null } | null;
  earnedAt?: Date | string;
  createdAt: Date | string;
};

/**
 * With the flag on for the viewer, an agent mention is Important only while it
 * is an unanswered Question. Answered = the viewer commented on the task after
 * the question; their agents' comments do not count. A task is quieted only when
 * no other active event would keep it Important. Flag off returns the rows
 * untouched.
 */
export async function markQuietAgentMentions<T extends QuietCandidate>(
  db: {
    comment: { groupBy: (args: any) => Promise<any[]> };
    notification: { findMany: (args: any) => Promise<any[]> };
    assignees?: { findMany: (args: any) => Promise<any[]> };
  },
  viewerId: number,
  rows: T[],
): Promise<T[]> {
  const agentMentions = rows.filter((row) => row.type === "Mentioned" && row.fromAgentId);
  if (agentMentions.length === 0 || !(await isQuietOwnerInboxOn(viewerId))) return rows;
  const taskIds = Array.from(
    new Set(agentMentions.flatMap((row) => (row.taskId == null ? [] : [row.taskId]))),
  );
  const own: { taskId: number; _max: { createdAt: Date | null } }[] = taskIds.length
    ? await db.comment.groupBy({
        by: ["taskId"],
        where: {
          taskId: { in: taskIds },
          creatorId: viewerId,
          agentId: null,
          activity: { equals: Prisma.DbNull },
        },
        _max: { createdAt: true },
      })
    : [];
  const answeredAt = new Map<number, number>();
  for (const group of own) {
    if (group._max.createdAt) answeredAt.set(group.taskId, group._max.createdAt.getTime());
  }
  const candidates = rows.filter((row) => isQuietAgentMention(row, answeredAt));
  if (candidates.length === 0) return rows;
  // getAll keeps one representative row per task. Quiet the task only when EVERY
  // active event that would make it Important today is a quiet agent mention. A
  // human mention, comment or Assigned event, a direct reply or an unanswered
  // agent Question keeps the task Important.
  const candidateTaskIds = Array.from(
    new Set(candidates.flatMap((row) => (row.taskId == null ? [] : [row.taskId]))),
  );
  const [events, assigned]: [any[], { taskId: number }[]] = await Promise.all([
    db.notification.findMany({
      where: { ...visibleUserInboxWhere(viewerId), taskId: { in: candidateTaskIds } },
      select: {
        type: true,
        taskId: true,
        fromAgentId: true,
        directReply: true,
        returnedFromReminders: true,
        createdAt: true,
        comment: { select: { text: true } },
      },
    }),
    db.assignees
      ? db.assignees.findMany({
          where: { taskId: { in: candidateTaskIds }, userId: viewerId, agentId: null },
          select: { taskId: true },
        })
      : Promise.resolve([]),
  ]);
  const assignedTaskIds = new Set(assigned.map((entry) => entry.taskId));
  const loudTaskIds = new Set(
    events
      .filter(
        (event) =>
          event.taskId != null &&
          eventKeepsImportant(event, answeredAt, assignedTaskIds.has(event.taskId)),
      )
      .map((event) => event.taskId as number),
  );
  return rows.map((row) =>
    isQuietAgentMention(row, answeredAt) && !(row.taskId != null && loudTaskIds.has(row.taskId))
      ? { ...row, quietImportant: true }
      : row,
  );
}
