import { useRecoilValue } from "@/lib/state";
import {
  aiChatPinnedAtom,
  openAiChatByDefaultAtom,
  isAiChatSidebarModeAtom,
  aiChatSidebarWidthPxAtom,
} from "@/store";
import { AI_CHAT_SIDEBAR_MIN_PX } from "@/lib/configs/style.config";
import {
  shouldShowMobileTabBar,
  shouldShowMobileDock,
  shouldShowMobilePrimaryDock,
  isTicketPagePath,
} from "@/components/Global/mobileShellVisibility";

export function usePageLoadReservations({
  mbl,
  pathname,
  authenticatedUserId,
  currentUserId,
  showAiChatInterface,
  aiChatAutoOpenSuppressed,
  mobilePageHideDockFlag,
  commentComposerOpen,
  agentChatHidesMobileShell,
}: {
  mbl: boolean;
  pathname: string | null;
  authenticatedUserId: number | null;
  currentUserId: number | undefined;
  showAiChatInterface: boolean;
  aiChatAutoOpenSuppressed: boolean;
  mobilePageHideDockFlag: boolean;
  commentComposerOpen: boolean;
  agentChatHidesMobileShell: boolean;
}) {
  const isTaskDetailPage = pathname?.startsWith("/detail") ?? false;
  const aiChatPinned = useRecoilValue(aiChatPinnedAtom);
  const openAiChatByDefault = useRecoilValue(openAiChatByDefaultAtom);
  const isAiChatSidebarMode = useRecoilValue(isAiChatSidebarModeAtom);
  const aiChatSidebarWidthPx = useRecoilValue(aiChatSidebarWidthPxAtom);
  // Match task auto-open before its hooks or the lazy chat runtime mount.
  const reserveAiSidebar = !mbl && isAiChatSidebarMode && (
    showAiChatInterface || (
      isTaskDetailPage && authenticatedUserId !== null &&
      (aiChatPinned || (openAiChatByDefault && !aiChatAutoOpenSuppressed))
    )
  );
  const sidebarWidthPx = reserveAiSidebar
    ? Math.max(aiChatSidebarWidthPx, AI_CHAT_SIDEBAR_MIN_PX)
    : 0;

  // The mobile shell (top bar + pull-to-command) is present on every root view
  // including task detail. The bottom dock is the exception: hidden on detail
  // (shouldShowMobileDock) so the composer owns the bottom edge.
  // Keep the path/auth shell check separate so the ticket flag can gate the
  // rendered chrome in JSX (feature-flag-gate requires that shape).
  // Reserve shell space from the server session before the profile query resolves.
  const showMobileShellPath =
    mbl && (authenticatedUserId !== null || Boolean(currentUserId)) && shouldShowMobileTabBar(pathname);
  const showMobileTabBar = showMobileShellPath && !agentChatHidesMobileShell;
  // Entering the mobile comment composer hides the bottom nav so the sheet
  // sits directly on the keyboard (the top bar stays for the back button).
  const showMobileBottomInset =
    mbl &&
    (authenticatedUserId !== null || Boolean(currentUserId)) &&
    shouldShowMobileDock(pathname) &&
    // HTPR-6860: ticket pages drop the dock like the ticket screen does.
    !(mobilePageHideDockFlag && isTicketPagePath(pathname)) &&
    !commentComposerOpen &&
    !agentChatHidesMobileShell;

  const showMobileBottomNav =
    showMobileBottomInset && shouldShowMobilePrimaryDock(pathname);

  return { sidebarWidthPx, showMobileShellPath, showMobileTabBar, showMobileBottomInset, showMobileBottomNav };
}
