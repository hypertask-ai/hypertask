const CHAT_COMPOSER_SELECTOR = [
  "[data-ai-chat-composer]",
  "[data-agent-chat-ai-composer]",
  "#agent-chat-composer-editor",
  "#ai-chat-tiptap-editor",
].join(", ");

const markedEvents = new WeakSet<Event>();

function elementOf(target: EventTarget | null | undefined): Element | null {
  if (target instanceof Element) return target;
  if (typeof Node !== "undefined" && target instanceof Node) return target.parentElement;
  return null;
}

function editableInComposer(element: Element | null): boolean {
  if (!element?.closest) return false;
  const editable = element.closest("input, textarea, [contenteditable='true']");
  if (!editable) return false;
  return Boolean(editable.closest(CHAT_COMPOSER_SELECTOR));
}

export function isSidebarChatComposerTarget(target: EventTarget | null | undefined): boolean {
  if (editableInComposer(elementOf(target))) return true;
  if (typeof document === "undefined") return false;
  const focused = elementOf(target);
  if (focused && focused !== document.body && focused !== document.documentElement) return false;
  return editableInComposer(document.activeElement);
}

export function markSidebarChatTyping(event: Event, enabled: boolean): void {
  if (!enabled || !isSidebarChatComposerTarget(event.target)) return;
  markedEvents.add(event);
}

export function sidebarChatTypingBlocksShortcuts(event: Event): boolean {
  return markedEvents.has(event);
}

export function sidebarChatTypingCapture(event: KeyboardEvent): void {
  markSidebarChatTyping(event, true);
}

export function shortcutsPanelRight(enabled: boolean): string | undefined {
  if (!enabled) return undefined;
  return "var(--ht-ai-sidebar-width, 0px)";
}
