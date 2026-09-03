type CommandCenterKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
>;

export const isAgentsRoute = (pathname: string | null | undefined) =>
  pathname === "/agents" || Boolean(pathname?.startsWith("/agents/"));

export const isCommandCenterShortcut = (
  event: CommandCenterKeyboardEvent,
  isApple: boolean,
  pathname: string | null,
) =>
  event.code === "KeyK" &&
  !event.altKey &&
  !event.shiftKey &&
  (event.ctrlKey || (isApple && event.metaKey)) &&
  Boolean(
    pathname?.startsWith("/project") ||
      pathname?.startsWith("/detail/") ||
      isAgentsRoute(pathname) ||
      pathname?.startsWith("/settings"),
  );
