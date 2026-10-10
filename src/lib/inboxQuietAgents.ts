import { isQuestionComment } from "@/lib/inboxDecisions";

/**
 * HTPR-7096: pure rules for a quiet owner inbox. Client safe, no flag reads.
 * Question detection is shared with HTPR-7092 (src/lib/inboxDecisions.ts), so the
 * Important split and the Decisions split agree.
 */
export { isQuestionComment };

type MentionRow = {
  type: string;
  fromAgentId?: string | null;
  comment?: { text?: string | null } | null;
  earnedAt?: string | Date;
  createdAt: string | Date;
  taskId: number | null;
};

/**
 * Whether a Mentioned row must stay out of Important. An agent mention counts
 * only when it is a Question that the viewer has not answered yet. Human
 * mentions and every other row type are never quiet.
 * `answeredAtByTaskId` holds the viewer's newest own comment time per task.
 */
export function isQuietAgentMention(
  row: MentionRow,
  answeredAtByTaskId: ReadonlyMap<number, number>,
): boolean {
  if (row.type !== "Mentioned" || !row.fromAgentId) return false;
  if (!isQuestionComment(row.comment?.text)) return true;
  if (row.taskId == null) return false;
  const answeredAt = answeredAtByTaskId.get(row.taskId);
  if (answeredAt === undefined) return false;
  return answeredAt > new Date(row.earnedAt ?? row.createdAt).getTime();
}
