const CHAT_SURFACE_SELECTOR = [
  ".chatwindow",
  ".bg-ai-chat",
  "[data-ai-chat-panel]",
  "[data-ai-chat-surface]",
  "[data-ai-chat-composer-root]",
  "[data-agent-chat-ai-composer]",
  "#ai-chat-tiptap-editor",
  "#agent-chat-composer-editor",
].join(", ");

const CHAT_HEADER_ID_PREFIXES = ["ai-chat-header-", "ai-chat-message-"];

export function isChatSurfaceElement(
  element: Element | null | undefined
): boolean {
  if (!element) return false;
  if (CHAT_HEADER_ID_PREFIXES.some((prefix) => element.id?.startsWith(prefix)))
    return true;
  return Boolean(element.closest?.(CHAT_SURFACE_SELECTOR));
}

export function isChatSurfaceTarget(
  target: EventTarget | null | undefined
): boolean {
  if (typeof document === "undefined") return false;
  const element = target as Element | null | undefined;
  return (
    isChatSurfaceElement(element?.closest ? element : null) ||
    isChatSurfaceElement(document.activeElement)
  );
}

export function isAIChatElementFocused(): boolean {
  if (typeof document === "undefined") return false;
  return isChatSurfaceElement(document.activeElement);
}
