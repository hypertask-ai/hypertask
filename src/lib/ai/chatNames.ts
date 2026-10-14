
export const DEFAULT_CHAT_TITLE = "New AI Chat";
export const CHAT_TITLE_MAX_LENGTH = 50;

type NamingContext = { taskTitle?: string | null; boardName?: string | null };

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function stripMarkup(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_~#>]+/g, " ")
    .replace(/(^|\s)[@#](?=\S)/g, "$1");
}

export function deriveChatTitle(message: string | null | undefined) {
  const text = clean(stripMarkup(message ?? ""));
  if (text.length <= CHAT_TITLE_MAX_LENGTH) return text;
  const cut = text.slice(0, CHAT_TITLE_MAX_LENGTH + 1);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, CHAT_TITLE_MAX_LENGTH);
  return `${head.replace(/[.,;:!?\s]+$/, "")}...`;
}

export function initialChatTitle(enabled: boolean, context: NamingContext) {
  if (!enabled) return null;
  const title = clean(context.taskTitle) || clean(context.boardName);
  return title ? title.slice(0, 120) : null;
}

export function isAutoChatTitle(currentTitle: string | null | undefined, context: NamingContext) {
  const title = clean(currentTitle);
  if (!title || title === DEFAULT_CHAT_TITLE) return true;
  return [context.taskTitle, context.boardName].some((candidate) => {
    const value = clean(candidate);
    return value !== "" && (title === value || title === value.slice(0, 120));
  });
}

export function firstMessageChatTitle(
  enabled: boolean,
  currentTitle: string | null | undefined,
  message: string | null | undefined,
  context: NamingContext,
) {
  if (!enabled || !isAutoChatTitle(currentTitle, context)) return null;
  return deriveChatTitle(message) || null;
}
