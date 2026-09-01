export type CommentEnterShortcutAction =
  | "send"
  | "send-and-stay"
  | "send-and-complete"
  | "consume"
  | "ignore";

const CANONICAL_APP_ORIGIN = "https://app.hypertask.ai";
const TASK_DETAIL_PATH = /^\/detail\/project-\d+\/\d+\/?$/;

function parseInternalTaskDetailHref(href: string): {
  isRootRelative: boolean;
  target: URL;
} | null {
  if (href.includes("\\") || href.startsWith("//")) return null;

  const isRootRelative = href.startsWith("/");
  let target: URL;
  try {
    target = new URL(href, CANONICAL_APP_ORIGIN);
  } catch {
    return null;
  }

  if (
    target.origin !== CANONICAL_APP_ORIGIN ||
    !TASK_DETAIL_PATH.test(target.pathname)
  ) {
    return null;
  }
  return { isRootRelative, target };
}

export function isInternalTaskDetailHref(href: string): boolean {
  return parseInternalTaskDetailHref(href) !== null;
}

export function preserveInboxFlowOnTaskHref(
  href: string,
  inboxFlow: string | null | undefined,
): string {
  if (inboxFlow !== "true") return href;

  const parsed = parseInternalTaskDetailHref(href);
  if (!parsed) return href;
  const { isRootRelative, target } = parsed;
  if (target.searchParams.get("inboxFlow") === "true") return href;

  target.searchParams.set("inboxFlow", "true");
  return isRootRelative
    ? `${target.pathname}${target.search}${target.hash}`
    : target.toString();
}

export function resolveCommentEnterShortcutAction({
  commandKey,
  key,
  shiftKey,
  altKey,
  isInboxFlow,
  isCommentMode,
  inInbox,
}: {
  commandKey: boolean;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  isInboxFlow: boolean;
  isCommentMode: boolean;
  inInbox: boolean;
}): CommentEnterShortcutAction | null {
  if (!commandKey || key !== "Enter") return null;

  if (shiftKey && !altKey) {
    if (!isInboxFlow) return "ignore";
    return isCommentMode ? "send-and-stay" : "send";
  }
  if (shiftKey && altKey) {
    if (!isCommentMode) return "send";
    return inInbox ? "send-and-complete" : "consume";
  }
  return "send";
}
