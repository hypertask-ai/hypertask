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

export const shouldOpenGlobalCreateTask = (
  pathname: string | null | undefined,
  myTasksShortcutsEnabled: boolean,
) => myTasksShortcutsEnabled || !pathname?.startsWith("/my-tasks");

type GlobalCreateTaskKeyboardEvent = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

export const isGlobalCreateTaskShortcut = (
  event: GlobalCreateTaskKeyboardEvent,
  pathname: string | null | undefined,
) =>
  (event.code === "KeyC" ||
    (!event.code && event.key.toLowerCase() === "c")) &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey &&
  isGlobalCreateTaskShortcutEnabled(pathname);
