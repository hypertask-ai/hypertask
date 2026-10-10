// HTPR-7092: which inbox tasks wait on the viewer's yes or no. Pure, so the server
// query and the tests share one rule.

// Plain text per paragraph or line. Block ends become newlines; remaining tags are
// removed until none are left.
const toLines = (html: string) => {
  let text = html.replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, "\n");
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);
  return text
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
};

const QUESTION_PREFIX = /^question:/i;

/** True when any paragraph or line opens with a bold or plain "Question:". */
export const isQuestionComment = (text: string | null | undefined) =>
  toLines(text ?? "").some((line) => QUESTION_PREFIX.test(line));

export type DecisionMentionComment = {
  taskId: number;
  text: string | null;
  commentText: string | null;
  createdAt: Date;
};

/**
 * A task is a decision for the viewer when a Question comment that mentions them
 * has no later comment by the viewer on the same task.
 */
export const pickDecisionTaskIds = (
  mentionComments: readonly DecisionMentionComment[],
  viewerComments: readonly { taskId: number; createdAt: Date }[],
): Set<number> => {
  const lastReply = new Map<number, number>();
  for (const comment of viewerComments) {
    lastReply.set(comment.taskId, Math.max(lastReply.get(comment.taskId) ?? 0, comment.createdAt.getTime()));
  }
  const ids = new Set<number>();
  for (const comment of mentionComments) {
    if (!isQuestionComment(comment.text) && !isQuestionComment(comment.commentText)) continue;
    if ((lastReply.get(comment.taskId) ?? 0) > comment.createdAt.getTime()) continue;
    ids.add(comment.taskId);
  }
  return ids;
};
