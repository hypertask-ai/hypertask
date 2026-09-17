type CommentAuthor = {
  creatorId?: number | string | null;
  creator?: { id?: number | string | null } | null;
};

const asUserId = (value: number | string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
};

/** True when this comment belongs to the signed-in user. */
export function isCommentCreatedByUser(
  comment: CommentAuthor | null | undefined,
  userId: number | string | null | undefined,
): boolean {
  const id = asUserId(userId);
  if (comment == null || id == null) return false;
  return asUserId(comment.creatorId) === id || asUserId(comment.creator?.id) === id;
}
