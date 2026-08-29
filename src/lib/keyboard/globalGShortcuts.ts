import { KeyCodes } from "@/lib/constants/keyboard-handler";

export type GlobalGShortcutAction =
  | "Timers"
  | "Reminders"
  | "Inbox"
  | "Snippets"
  | "Starred"
  | "Pinned"
  | "Task Archive"
  | "Inbox Archive"
  | "Trash"
  | "All Tasks"
  | "My Tasks"
  | "Drafts"
  | "Scheduled"
  | "Board"
  | "Calendar";

type GlobalGShortcutEvent = Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "keyCode"
  | "metaKey"
  | "preventDefault"
  | "repeat"
  | "shiftKey"
  | "stopImmediatePropagation"
>;

const GLOBAL_G_SHORTCUTS = new Map<number, GlobalGShortcutAction>([
  [KeyCodes.T, "Timers"],
  [KeyCodes.H, "Reminders"],
  [KeyCodes.I, "Inbox"],
  [KeyCodes.SEMICOLON, "Snippets"],
  [KeyCodes.S, "Starred"],
  [KeyCodes.P, "Pinned"],
  [KeyCodes.E, "Task Archive"],
  [KeyCodes.R, "Inbox Archive"],
  [KeyCodes.A, "All Tasks"],
  [KeyCodes.M, "My Tasks"],
  [KeyCodes.D, "Drafts"],
  [KeyCodes.U, "Scheduled"],
  [KeyCodes.B, "Board"],
  [KeyCodes.C, "Calendar"],
]);

export function resolveGlobalGShortcut(
  event: Pick<
    GlobalGShortcutEvent,
    "altKey" | "ctrlKey" | "keyCode" | "metaKey" | "shiftKey"
  >,
): GlobalGShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.shiftKey) {
    return event.keyCode === KeyCodes.THREE ? "Trash" : null;
  }
  return GLOBAL_G_SHORTCUTS.get(event.keyCode) ?? null;
}

export function createGlobalGShortcutCapture({
  delayMs,
  now = Date.now,
  onShortcut,
  shouldIgnore = () => false,
}: {
  delayMs: number;
  now?: () => number;
  onShortcut: (
    action: GlobalGShortcutAction,
    event: GlobalGShortcutEvent,
  ) => void | Promise<void>;
  shouldIgnore?: () => boolean;
}) {
  let startedAt: number | null = null;

  return (event: GlobalGShortcutEvent) => {
    if (shouldIgnore()) {
      startedAt = null;
      return;
    }
    if (
      event.keyCode === KeyCodes.G &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.repeat
    ) {
      startedAt = now();
      return;
    }

    const action = resolveGlobalGShortcut(event);
    const timestamp = now();
    if (
      !action ||
      startedAt === null ||
      timestamp - startedAt >= delayMs
    ) {
      if (startedAt !== null && timestamp - startedAt >= delayMs) {
        startedAt = null;
      }
      return;
    }

    startedAt = null;
    event.preventDefault();
    event.stopImmediatePropagation();
    void onShortcut(action, event);
  };
}
