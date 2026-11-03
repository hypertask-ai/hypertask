export const INBOX_ROW_FILL_FALLBACK_TEXT = "No comments or description yet";

export const INBOX_ROW_PREVIEW_MAX_CHARS = 240;

export interface InboxRowFillSource {
  commentText: string;
  commentAuthor: string;
  commentId: number | null;
  latestCommentText: string;
  latestCommentAuthor: string;
  descriptionText: string;
  title: string;
  reason: string;
  reasonShowsText?: boolean;
}

export type InboxRowFillPartKind = "comment" | "reason" | "description" | "empty";

export interface InboxRowFillPart {
  kind: InboxRowFillPartKind;
  text: string;
  author?: string;
}

export const clipInboxPreview = (text: string): string => {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= INBOX_ROW_PREVIEW_MAX_CHARS) return plain;
  const cut = plain.slice(0, INBOX_ROW_PREVIEW_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}...`;
};

export function buildInboxRowFillParts(source: InboxRowFillSource): InboxRowFillPart[] {
  const parts: InboxRowFillPart[] = [];
  if (source.commentId != null && source.commentText.trim()) {
    parts.push({ kind: "comment", text: source.commentText, author: source.commentAuthor });
  } else if (source.reason.trim()) {
    parts.push({ kind: "reason", text: source.reason });
  }

  const latestComment = clipInboxPreview(source.latestCommentText);
  if (latestComment && clipInboxPreview(source.commentText) !== latestComment) {
    parts.push({ kind: "comment", text: source.latestCommentText, author: source.latestCommentAuthor });
  }

  const description = clipInboxPreview(source.descriptionText);
  if (description && description !== source.title.trim()) {
    parts.push({ kind: "description", text: source.descriptionText });
  }

  if (parts.length === 0) return [];
  const skippedText = Boolean(latestComment || description);
  if (parts.length === 1 && parts[0].kind === "reason" && !source.reasonShowsText && !skippedText) {
    parts.push({ kind: "empty", text: INBOX_ROW_FILL_FALLBACK_TEXT });
  }
  return parts;
}
