import prisma from "@/lib/prisma";

export type CommentWithSeen = {
  seen?: number[] | null;
};

export function omitCommentSeen<T extends CommentWithSeen>(
  comment: T,
): Omit<T, "seen"> {
  const { seen: _seen, ...commentWithoutSeen } = comment;
  return commentWithoutSeen;
}

// The viewer's own id always stays in seen: comment stacking keys off
// seen.includes(viewerId), and knowing your own read state is not a receipt.
const keepOnlySelf = <T extends CommentWithSeen>(
  comment: T,
  viewerId: number,
): T => ({
  ...comment,
  seen: (comment.seen ?? []).filter((userId) => userId === viewerId),
});

export async function filterCommentReadReceipts<T extends CommentWithSeen>(
  comments: T[],
  viewerId: number,
  viewerSharesReadReceipts?: boolean,
): Promise<T[]> {
  if (viewerSharesReadReceipts === false) {
    return comments.map((comment) => keepOnlySelf(comment, viewerId));
  }

  const seenUserIds = new Set<number>();
  for (const comment of comments) {
    for (const userId of comment.seen ?? []) seenUserIds.add(userId);
  }

  const relevantUserIds = new Set(seenUserIds);
  if (viewerSharesReadReceipts === undefined) relevantUserIds.add(viewerId);

  const sharingSettings = relevantUserIds.size
    ? await prisma.userSetting.findMany({
        where: { userId: { in: Array.from(relevantUserIds) } },
        select: { userId: true, shareReadReceipts: true },
      })
    : [];
  const sharingUserIds = new Set(
    sharingSettings
      .filter((setting) => setting.shareReadReceipts)
      .map((setting) => setting.userId),
  );
  const viewerShares =
    viewerSharesReadReceipts ?? sharingUserIds.has(viewerId);

  if (!viewerShares)
    return comments.map((comment) => keepOnlySelf(comment, viewerId));

  return comments.map((comment) => ({
    ...comment,
    seen: (comment.seen ?? []).filter(
      (userId) => sharingUserIds.has(userId) || userId === viewerId,
    ),
  }));
}
