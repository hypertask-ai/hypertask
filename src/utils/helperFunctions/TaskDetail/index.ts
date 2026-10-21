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
  const lastCommentIndex = comments.reduce(
    (latestIndex, comment, index) =>
      comment.activity ? latestIndex : index,
    -1
  );

  const match = hash.match(/comment-(\d+)/);
  if (match && match[1]) {
    hashCommentIndex = parseInt(match[1], 10);
  }

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
  const escapedDataLabel = escapeHtml(dataLabel);
  const extraAttr = isAi ? ` text="${escapedDisplayName}"` : "";
  const replyQuoteAttribute = isAi
    ? ""
    : ` ${REPLY_QUOTE_DATA_ATTRIBUTE}="true"`;
  const mention = `<span data-type="mention" class="mention" data-id="${escapedDataId}" data-label="${escapedDataLabel}" uniqueindex="" projectid=""${extraAttr} contenteditable="false">${escapedDisplayName}</span> said <blockquote${replyQuoteAttribute}>${content}</blockquote>`;
  return isAi ? `${mention}<p></p>` : mention;
}
