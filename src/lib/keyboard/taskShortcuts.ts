import { KeyCodes } from "@/lib/constants/keyboard-handler";
import {
  keyboard_shortcuts,
  matchesShortcut,
} from "@/lib/utils/keyboardShortcuts";

export type TaskShortcutAction =
  | "select"
  | "delete"
  | "archive"
  | "size"
  | "priority"
  | "edit"
  | "assignee"
  | "dueDate"
  | "label"
  | "share"
  | "moveColumn"
  | "moveBoard"
  | "open"
  | "star"
  | "rename";

type TaskShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "keyCode" | "metaKey" | "repeat" | "shiftKey"
>;

type TaskShortcutTarget = {
  closest?: (selector: string) => unknown;
  isContentEditable?: boolean;
  tagName?: string;
} | null;

export function shouldIgnoreTaskShortcutTarget(
  target: TaskShortcutTarget,
): boolean {
  if (!target) return false;
  const tagName = target.tagName?.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable === true ||
    Boolean(
      target.closest?.(
        '[contenteditable="true"], .ProseMirror, [role="textbox"], [role="dialog"], .modal',
      ),
    )
  );
}

export function getTaskShortcutAction(
  event: TaskShortcutEvent,
  isApple: boolean,
): TaskShortcutAction | null {
  if (event.repeat) return null;

  // Block plain-key actions when either modifier is held (avoids Ctrl+A on Mac).
  const anyCommandModifier = event.ctrlKey || event.metaKey;
  // Archive/share stay platform-native: Command on Apple, Control elsewhere.
  const nativeCommandModifier = isApple ? event.metaKey : event.ctrlKey;

  if (
    event.keyCode === KeyCodes.X &&
    !event.shiftKey &&
    !event.altKey &&
    !anyCommandModifier
  ) {
    return "select";
  }
  if (
    event.shiftKey &&
    event.keyCode === KeyCodes.THREE &&
    !event.altKey &&
    !anyCommandModifier
  ) {
    return "delete";
  }
  if (
    event.keyCode === KeyCodes.E &&
    nativeCommandModifier &&
    !event.shiftKey &&
    !event.altKey
  ) {
    return "archive";
  }
  if (
    event.keyCode === KeyCodes.S &&
    !event.shiftKey &&
    !anyCommandModifier &&
    !event.altKey
  ) {
    return "size";
  }
  if (event.keyCode === KeyCodes.P && !anyCommandModifier && !event.altKey) {
    return "priority";
  }
  if (
    event.keyCode === KeyCodes.E &&
    !anyCommandModifier &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return "edit";
  }
  if (
    event.keyCode === KeyCodes.A &&
    !anyCommandModifier &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return "assignee";
  }
  if (
    matchesShortcut(
      event as KeyboardEvent,
      keyboard_shortcuts.dueDateModal.default,
      isApple,
    )
  ) {
    return "dueDate";
  }
  if (
    event.keyCode === KeyCodes.T &&
    !event.shiftKey &&
    !anyCommandModifier &&
    !event.altKey
  ) {
    return "label";
  }
  if (
    event.keyCode === KeyCodes.S &&
    nativeCommandModifier &&
    !event.shiftKey &&
    !event.altKey
  ) {
    return "share";
  }
  if (event.keyCode === KeyCodes.M && !anyCommandModifier && !event.shiftKey) {
    return "moveColumn";
  }
  if (event.keyCode === KeyCodes.M && event.shiftKey && !anyCommandModifier) {
    return "moveBoard";
  }
  if (event.keyCode === KeyCodes.ENTER) return "open";
  if (event.keyCode === KeyCodes.S && event.altKey && !event.shiftKey) {
    return "star";
  }
  if (event.keyCode === KeyCodes.F2) return "rename";
  return null;
}
