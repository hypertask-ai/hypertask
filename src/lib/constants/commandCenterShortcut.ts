type CommandCenterKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "metaKey" | "shiftKey"
>;

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
      pathname?.startsWith("/agents") ||
      pathname?.startsWith("/settings"),
  );
