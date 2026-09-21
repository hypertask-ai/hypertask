import { IComment, IUser } from "@/models/model";
import { escapeHtml } from "@/utils/htmlEscape";
import { REPLY_QUOTE_DATA_ATTRIBUTE } from "@/lib/richText/replyQuote";

export function processComments(
  comments: IComment[],
  userId: number,
  stack: any,
  hash: string,
  newCommentIds: number[] = []
) {
  const initialMap: any = {};
  let hashCommentIndex: number | null = null;
  const newCommentIdSet = new Set(newCommentIds);
  // Activity rows are compact by design. The newest actual comment is the
  // fallback reader context whenever there are no unread comments to open.
  const lastCommentIndex = comments.reduce(
    (latestIndex, comment, index) =>
      comment.activity ? latestIndex : index,
    -1
  );

  // Extract the numeric part from the hash
  const match = hash.match(/comment-(\d+)/);
  if (match && match[1]) {
    hashCommentIndex = parseInt(match[1], 10);
  }

  // Process each comment. Always keep the newest actual comment open so a task
  // never lands in an all-collapsed state when every comment has been seen.
  comments.map((item: IComment, index: number) => {
    let pinned: boolean | undefined = undefined;
    if (item.savedContent && item.savedContent.length > 0) {
      pinned = item.savedContent.find((sc) => sc.type === "Public")
        ? false
        : undefined;
    }
    initialMap[index] = index === lastCommentIndex || newCommentIdSet.has(Number(item.id))
      ? false
      : (pinned ?? item.seen?.includes(userId))
        ? stack
        : false;
  });

  // Handle the specific comment from the hash
  if (hashCommentIndex !== null && comments[hashCommentIndex]) {
    initialMap[hashCommentIndex] = false;
  }

  return initialMap;
}

export function ensureAtLeastOneCommentIsOpen(
  comments: IComment[],
  stacked: Record<number, boolean>
) {
  const hasOpenComment = comments.some(
    (comment, index) => !comment.activity && !stacked[index]
  );
  if (hasOpenComment) return stacked;

  for (let index = comments.length - 1; index >= 0; index -= 1) {
    if (!comments[index]?.activity) {
      return { ...stacked, [index]: false };
    }
  }

  return stacked;
}

export const createEmojiFinder = (emojiData: any) => {
  const emojiMap = new Map();

  Object.values(emojiData).forEach((category: any) => {
    category.forEach((emoji: any) => {
      emojiMap.set(emoji.u, emoji);
      if (emoji.v && Array.isArray(emoji.v)) {
        emoji.v.forEach((variation: string) => {
          emojiMap.set(variation, emoji);
        });
      }
    });
  });

  return (unicodeValue: any) => {
    const emoji = emojiMap.get(unicodeValue) || null;
    if (!emoji) return "";

    const semantic = emoji.n[0];
    return `:${semantic.replace(/\s+/g, "_")}:`;
  };
};

export function wrapBlockQuote(
  content: string,
  quoter: IUser,
  aiMention = false
) {
  const hyperAiId = Number(process.env.NEXT_PUBLIC_HYPERAI_ID) || 332;
  const isAi = aiMention;
  const dataId = isAi ? quoter.id : quoter.displayName;
  const escapedDataId = escapeHtml(String(dataId ?? ""));
  const escapedDisplayName = escapeHtml(quoter.displayName ?? "");
  const dataLabel = isAi
    ? "name"
    : hyperAiId === quoter.id
      ? ""
      : `name-${quoter.id}`;
  // SECURITY: Preserve staging display/data escaping and add label escaping for the generated mention wrapper.
  const escapedDataLabel = escapeHtml(dataLabel);
  const extraAttr = isAi ? ` text="${escapedDisplayName}"` : "";
  const replyQuoteAttribute = isAi
    ? ""
    : ` ${REPLY_QUOTE_DATA_ATTRIBUTE}="true"`;
  const mention = `<span data-type="mention" class="mention" data-id="${escapedDataId}" data-label="${escapedDataLabel}" uniqueindex="" projectid=""${extraAttr} contenteditable="false">${escapedDisplayName}</span> said <blockquote${replyQuoteAttribute}>${content}</blockquote>`;
  // Add a <p></p> at the end for additional space if aiMention is true
  return isAi ? `${mention}<p></p>` : mention;
}
