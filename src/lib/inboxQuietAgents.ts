/**
 * HTPR-7096: pure rules for a quiet owner inbox. Client safe, no flag reads.
 *
 * HTPR-7092 shares this: isQuestionComment mirrors the semantics of
 * isQuestionComment in src/lib/inboxDecisions.ts (Question: at the start of any
 * paragraph or line, bold or plain). Switch to importing it once that file is on
 * production.
 */

/** True when any paragraph or line of the comment HTML starts with "Question:". */
export function isQuestionComment(text: string | null | undefined): boolean {
  if (!text) return false;
  return text
    .split(/<\/(?:p|li|h[1-6]|blockquote|div)>|<br\s*\/?>|<(?:p|li|div)[\s>]|\r?\n/i)
    .some((part) =>
      part
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .trim()
        .startsWith("Question:"),
    );
}

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
