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
  const reserveAiSidebar = !mbl && isAiChatSidebarMode && (
    showAiChatInterface || (
      isTaskDetailPage && authenticatedUserId !== null &&
      (aiChatPinned || (openAiChatByDefault && !aiChatAutoOpenSuppressed))
    )
  );
  const sidebarWidthPx = reserveAiSidebar
    ? Math.max(aiChatSidebarWidthPx, AI_CHAT_SIDEBAR_MIN_PX)
    : 0;

  const showMobileShellPath =
    mbl && (authenticatedUserId !== null || Boolean(currentUserId)) && shouldShowMobileTabBar(pathname);
  const showMobileTabBar = showMobileShellPath && !agentChatHidesMobileShell;
  const showMobileBottomInset =
    mbl &&
    (authenticatedUserId !== null || Boolean(currentUserId)) &&
    shouldShowMobileDock(pathname) &&
    !(mobilePageHideDockFlag && isTicketPagePath(pathname)) &&
    !commentComposerOpen &&
    !agentChatHidesMobileShell;

  const showMobileBottomNav =
    showMobileBottomInset && shouldShowMobilePrimaryDock(pathname);

  return { sidebarWidthPx, showMobileShellPath, showMobileTabBar, showMobileBottomInset, showMobileBottomNav };
}
