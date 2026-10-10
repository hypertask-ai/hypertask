// HTPR-7092: which inbox tasks wait on the viewer's yes or no. Pure, so the server
// query and the tests share one rule.

// Plain text only, to test the "Question:" prefix. Tags are removed until none are left.
const stripHtml = (html: string) => {
  let text = html;
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, " ");
  } while (text !== previous);
  return text.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
};

const QUESTION_PREFIX = /^question:/i;

/** True when a comment (HTML or plain text) opens with a bold or plain "Question:". */
export const isQuestionComment = (text: string | null | undefined) =>
  QUESTION_PREFIX.test(stripHtml(text ?? ""));

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
    if (!isQuestionComment(comment.commentText || comment.text)) continue;
    if ((lastReply.get(comment.taskId) ?? 0) > comment.createdAt.getTime()) continue;
    ids.add(comment.taskId);
  }
  return ids;
};
