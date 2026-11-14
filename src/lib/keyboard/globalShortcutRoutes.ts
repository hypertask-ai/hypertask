import { KeyCodes } from "@/lib/constants/keyboard-handler";
import { isChatSurfaceTarget } from "@/lib/keyboard/chatSurfaceFocus";

const GLOBAL_SHORTCUT_BLOCKED_ROUTES = [
  "/interactive-onboarding",
  "/learn",
  "/share",
  "/new",
  "/qa/login",
] as const;

const GLOBAL_CREATE_TASK_BLOCKED_ROUTES = [
  "/login",
  "/qa/login",
  "/project",
  "/detail",
  "/onboarding",
  "/trial-plan-confirmation",
  "/inbox",
  "/calendar",
  "/new",
] as const;

const startsWithAny = (
  pathname: string | null | undefined,
  routes: readonly string[],
) => Boolean(pathname && routes.some((route) => pathname.startsWith(route)));

export const areGlobalShortcutsEnabled = (
  pathname: string | null | undefined,
) => !startsWithAny(pathname, GLOBAL_SHORTCUT_BLOCKED_ROUTES);

export const isGlobalCreateTaskShortcutEnabled = (
  pathname: string | null | undefined,
) => !startsWithAny(pathname, GLOBAL_CREATE_TASK_BLOCKED_ROUTES);

type GlobalCreateTaskKeyboardEvent = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

type ChatGuardKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "keyCode" | "metaKey"
>;

export const chatOwnsKey = (
  agentChatKeys: boolean,
  event: ChatGuardKeyboardEvent,
  target: EventTarget | null | undefined,
) =>
  agentChatKeys &&
  event.keyCode !== KeyCodes.ESCAPE &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  isChatSurfaceTarget(target);

export const isGlobalCreateTaskShortcut = (
  event: GlobalCreateTaskKeyboardEvent,
  pathname: string | null | undefined,
) =>
  (event.code === "KeyC" ||
    (!event.code &&
      typeof event.key === "string" &&
      event.key.toLowerCase() === "c")) &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey &&
  isGlobalCreateTaskShortcutEnabled(pathname);
