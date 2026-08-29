/**
 * Emergency kill switch for both keyboard-first tutorial implementations.
 *
 * Keep this server/client-safe: the proxy, API bootstrap, onboarding, command
 * palette, settings, and persisted-state cleanup all rely on the same value.
 */
export const KEYBOARD_SHORTCUT_TUTORIAL_ENABLED = false;

const KEYBOARD_SHORTCUT_TUTORIAL_PATHS = [
  "/learn",
  "/interactive-onboarding",
] as const;

const KEYBOARD_SHORTCUT_TUTORIAL_QUERY_PARAMS = [
  "tutorial",
  "tutorialInbox",
  "tutorialReturn",
] as const;

export const isKeyboardShortcutTutorialPath = (pathname: string) =>
  KEYBOARD_SHORTCUT_TUTORIAL_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

export const hasKeyboardShortcutTutorialQuery = (
  searchParams: URLSearchParams,
) =>
  KEYBOARD_SHORTCUT_TUTORIAL_QUERY_PARAMS.some((param) =>
    searchParams.has(param),
  );

export const removeKeyboardShortcutTutorialQuery = (
  searchParams: URLSearchParams,
) => {
  KEYBOARD_SHORTCUT_TUTORIAL_QUERY_PARAMS.forEach((param) =>
    searchParams.delete(param),
  );
};
