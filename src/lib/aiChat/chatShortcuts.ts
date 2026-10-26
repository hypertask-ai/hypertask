type Binding = {
  key: string;
  code?: string;
  ctrl?: boolean;
  command?: boolean;
  shift?: boolean;
  alt?: boolean;
  outsideInput?: boolean;
  label: string;
};

type Shortcut = {
  id: string;
  label: string;
  bindings: readonly Binding[];
};

export const CHAT_SHORTCUTS = [
  { id: "new", label: "New chat", bindings: [{ key: "o", command: true, shift: true, label: "Ctrl+Shift+O" }] },
  { id: "next", label: "Next chat", bindings: [{ key: "Tab", ctrl: true, label: "Ctrl+Tab" }, { key: "ArrowDown", alt: true, label: "Alt+Down" }] },
  { id: "previous", label: "Previous chat", bindings: [{ key: "Tab", ctrl: true, shift: true, label: "Ctrl+Shift+Tab" }, { key: "ArrowUp", alt: true, label: "Alt+Up" }] },
  { id: "scope", label: "Board scope", bindings: [{ key: "b", command: true, shift: true, label: "Ctrl+Shift+B" }] },
  { id: "search", label: "Search chats", bindings: [{ key: "f", command: true, shift: true, label: "Ctrl+Shift+F" }] },
  { id: "focus", label: "Focus message box", bindings: [{ key: "q", ctrl: true, label: "Ctrl+Q" }] },
  { id: "model", label: "Model and effort", bindings: [{ key: "m", command: true, shift: true, label: "Ctrl+Shift+M" }] },
  { id: "attach", label: "Attach files", bindings: [{ key: "u", command: true, label: "Ctrl+U" }] },
  { id: "mic", label: "Start or stop dictation", bindings: [{ key: "d", command: true, shift: true, label: "Ctrl+Shift+D" }] },
  { id: "mention", label: "Mention a task or board", bindings: [{ key: "2", code: "Digit2", alt: true, label: "Alt+2" }] },
  { id: "send", label: "Send message", bindings: [{ key: "Enter", label: "Enter" }, { key: "Enter", command: true, label: "Ctrl+Enter" }] },
  { id: "stop", label: "Stop reply", bindings: [{ key: "Escape", label: "Escape" }] },
  { id: "pin", label: "Pin or unpin chat", bindings: [{ key: "p", command: true, shift: true, label: "Ctrl+Shift+P" }] },
  { id: "delete", label: "Delete chat (confirm first)", bindings: [{ key: "Backspace", command: true, shift: true, label: "Ctrl+Shift+Backspace" }] },
  { id: "help", label: "Chat shortcuts", bindings: [{ key: "?", shift: true, outsideInput: true, label: "?" }, { key: "/", code: "Slash", alt: true, label: "Alt+/" }] },
] as const satisfies readonly Shortcut[];

export type ChatShortcutId = (typeof CHAT_SHORTCUTS)[number]["id"];

export function chatShortcutHint(id: ChatShortcutId, isApple = false) {
  const shortcut = CHAT_SHORTCUTS.find((item) => item.id === id);
  return shortcut?.bindings.map((binding) =>
    (isApple && "command" in binding ? binding.label.replace("Ctrl", "Cmd") : binding.label).replace("Alt", isApple ? "Option" : "Alt")
  ).join(" / ") ?? "";
}

export function dispatchChatShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing" | "defaultPrevented" | "preventDefault" | "stopPropagation">,
  context: {
    insideChat: boolean;
    desktop: boolean;
    editable: boolean;
    run: (id: ChatShortcutId) => boolean;
  },
) {
  if (!context.insideChat || !context.desktop || event.defaultPrevented || event.repeat || event.isComposing || typeof event.key !== "string") return false;
  const shortcut = matchChatShortcut(event, context.editable);
  if (!shortcut || !context.run(shortcut)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function adjacentChatSession(ids: string[], currentId: string | undefined, direction: "next" | "previous") {
  const index = ids.indexOf(currentId ?? "");
  if (index < 0) return direction === "next" ? ids[0] : ids[ids.length - 1];
  return ids[index + (direction === "next" ? 1 : -1)];
}

export function matchChatShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  editable: boolean,
): ChatShortcutId | undefined {
  if (typeof event.key !== "string") return;
  const shortcut = CHAT_SHORTCUTS.find((item) => item.bindings.some((binding: Binding) =>
    (binding.code && event.code ? binding.code === event.code : binding.key.toLowerCase() === event.key.toLowerCase()) &&
    Boolean(binding.shift) === event.shiftKey &&
    Boolean(binding.alt) === event.altKey &&
    (binding.command ? event.ctrlKey !== event.metaKey : Boolean(binding.ctrl) === event.ctrlKey && !event.metaKey) &&
    !(binding.outsideInput && editable)
  ));
  return shortcut?.id;
}
