const hiddenShellPaths = [
  "/chat",
  "/interactive-onboarding",
  "/learn",
  "/login",
  "/new",
  "/onboarding",
  "/settings",
  "/share",
  "/trial-plan-confirmation",
];

export const shouldShowMobileTabBar = (pathname: string | null) =>
  Boolean(
    pathname &&
    !hiddenShellPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    ),
  );

export const shouldShowMobileDock = (pathname: string | null) =>
  shouldShowMobileTabBar(pathname) &&
  !(pathname?.startsWith("/detail") ?? false);

export const shouldShowMobileCreateTaskButton = (pathname: string | null) =>
  shouldShowMobileDock(pathname) &&
  Boolean(
    pathname &&
      ["/project", "/calendar", "/inbox"].some((path) =>
        pathname.startsWith(path),
      ),
  );

export const isMobileInboxPath = (pathname: string | null) =>
  pathname === "/inbox" || (pathname?.startsWith("/inbox/") ?? false);

// Inbox supplies its own split dock in the same thumb-zone space. The regular
// five-tab navigation returns as soon as the user leaves the Inbox route.
export const shouldShowMobilePrimaryDock = (pathname: string | null) =>
  shouldShowMobileDock(pathname) && !isMobileInboxPath(pathname);

export const shouldEnableMobilePullDownCommand = (pathname: string | null) =>
  Boolean(
    pathname &&
    ["/project", "/inbox", "/calendar", "/detail"].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    ),
  );
