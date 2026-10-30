import { inboxConfig } from "@/lib/configs/inbox.config";

export const toLines = (html: string) => {
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

export const isQuestionComment = (text: string | null | undefined) =>
  toLines(text ?? "").some((line) => QUESTION_PREFIX.test(line));

export type DecisionMentionComment = {
  taskId: number;
  commentId: number;
  text: string | null;
  commentText: string | null;
  createdAt: Date;
};

export const pickDecisionComments = (
  mentionComments: readonly DecisionMentionComment[],
  viewerComments: readonly { taskId: number; createdAt: Date }[],
  blockerClears: readonly { taskId: number; createdAt: Date }[] = [],
): Map<number, DecisionMentionComment> => {
  const lastReply = new Map<number, number>();
  for (const comment of [...viewerComments, ...blockerClears]) {
    lastReply.set(comment.taskId, Math.max(lastReply.get(comment.taskId) ?? 0, comment.createdAt.getTime()));
  }
  const decisions = new Map<number, DecisionMentionComment>();
  for (const comment of mentionComments) {
    if (!isQuestionComment(comment.text) && !isQuestionComment(comment.commentText)) continue;
    if ((lastReply.get(comment.taskId) ?? 0) > comment.createdAt.getTime()) continue;
    const previous = decisions.get(comment.taskId);
    if (
      !previous || comment.createdAt > previous.createdAt ||
      (comment.createdAt.getTime() === previous.createdAt.getTime() && comment.commentId > previous.commentId)
    ) {
      decisions.set(comment.taskId, comment);
    }
  }
  return decisions;
};

export const withDecisionCommentAnchor = (
  href: string,
  commentId: number | undefined,
  enabled: boolean,
): string => enabled && commentId
  ? `${href.split("#")[0]}${inboxConfig.urls.commentHash(commentId)}`
  : href;
