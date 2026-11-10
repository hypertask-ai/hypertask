type CommandCenterKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
>;

export const COMMAND_MENU_ROUTE_HOSTS = [
  "/project",
  "/detail",
  "/page",
  "/search",
  "/inbox",
  "/all-tasks",
  "/calendar",
  "/scheduled",
  "/reminders",
  "/report",
  "/starred",
  "/pinned",
  "/archived",
] as const;

const NO_COMMAND_MENU_ROUTES = [
  "/login",
  "/qa/login",
  "/invite",
  "/reset",
  "/pricing",
  "/oauth",
  "/cli-auth",
  "/share",
  "/verify-email",
  "/trial",
  "/trial-plan-confirmation",
  "/full-plan-confirmation",
  "/unauthorized",
  "/onboarding",
  "/interactive-onboarding",
  "/new",
  "/learn",
  "/demo",
] as const;

const isCommandMenuRoute = (pathname: string | null) =>
  Boolean(pathname) &&
  !NO_COMMAND_MENU_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(`${route}/`),
  );

export const shouldRenderGlobalCommandMenu = (
  pathname: string | null,
  myTasksSingleCommandCenter = false,
) =>
  isCommandMenuRoute(pathname) &&
  !(myTasksSingleCommandCenter &&
    (pathname === "/my-tasks" || pathname?.startsWith("/my-tasks/"))) &&
  !COMMAND_MENU_ROUTE_HOSTS.some(
    (route) => pathname === route || pathname?.startsWith(`${route}/`),
  );

export const isCommandCenterShortcut = (
  event: CommandCenterKeyboardEvent,
  isApple: boolean,
  pathname: string | null,
) =>
  event.code === "KeyK" &&
  !event.altKey &&
  !event.shiftKey &&
  (event.ctrlKey || (isApple && event.metaKey)) &&
  isCommandMenuRoute(pathname);

export const isComposePaletteShortcut = (
  event: CommandCenterKeyboardEvent & { isComposing?: boolean },
  isApple: boolean,
  pathname: string | null,
) =>
  !event.isComposing &&
  (event.code === "KeyJ" || event.code === "KeyK") &&
  !event.altKey && !event.shiftKey &&
  (event.ctrlKey || (isApple && event.metaKey)) &&
  (isCommandMenuRoute(pathname) || pathname === "/new");

export const TICKET_EDITOR_CTRL_J_ATTRIBUTE = "data-ctrl-j-write-with-ai";

export const isTicketEditorWriteWithAiShortcut = (
  event: CommandCenterKeyboardEvent & { target: EventTarget | null },
) =>
  event.code === "KeyJ" &&
  typeof (event.target as Element | null)?.closest === "function" &&
  Boolean((event.target as Element).closest(`[${TICKET_EDITOR_CTRL_J_ATTRIBUTE}]`));
