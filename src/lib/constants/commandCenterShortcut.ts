type CommandCenterKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
>;

// These surfaces already mount the palette, sometimes with task/board context.
// The shell owns it everywhere else, including settings and new app routes.
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

export const shouldRenderGlobalCommandMenu = (pathname: string | null) =>
  isCommandMenuRoute(pathname) &&
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
