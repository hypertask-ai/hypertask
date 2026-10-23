import { useFlag } from "@/hooks/useFlag";
import { HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG } from "@/lib/flags/definitions/htpr-7650-ai-chat-open-switches";
import { useKeepAiChatClosed } from "@/hooks/General/useKeepAiChatClosed";
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
  reserveBoardChat,
  aiChatAutoOpenSuppressed,
  commentComposerOpen,
  agentChatHidesMobileShell,
}: {
  mbl: boolean;
  pathname: string | null;
  authenticatedUserId: number | null;
  currentUserId: number | undefined;
  showAiChatInterface: boolean;
  reserveBoardChat: boolean;
  aiChatAutoOpenSuppressed: boolean;
  commentComposerOpen: boolean;
  agentChatHidesMobileShell: boolean;
}) {
  const aiChatOpenSwitchesEnabled = useFlag(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG);
  const { keepAiChatClosed, ready: chatAutoOpenReady } = useKeepAiChatClosed();
  const isTaskDetailPage = pathname?.startsWith("/detail") ?? false;
  const aiChatPinned = useRecoilValue(aiChatPinnedAtom);
  const openAiChatByDefault = useRecoilValue(openAiChatByDefaultAtom);
  const isAiChatSidebarMode = useRecoilValue(isAiChatSidebarModeAtom);
  const aiChatSidebarWidthPx = useRecoilValue(aiChatSidebarWidthPxAtom);
  const reserveAiSidebar = !mbl && isAiChatSidebarMode && (
    showAiChatInterface || (!aiChatOpenSwitchesEnabled && chatAutoOpenReady && !keepAiChatClosed && (reserveBoardChat || (
      isTaskDetailPage && authenticatedUserId !== null &&
      (aiChatPinned || (openAiChatByDefault && !aiChatAutoOpenSuppressed))
    )))
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
    !isTicketPagePath(pathname) &&
    !commentComposerOpen &&
    !agentChatHidesMobileShell;

  const showMobileBottomNav =
    showMobileBottomInset && shouldShowMobilePrimaryDock(pathname);

  return { sidebarWidthPx, showMobileShellPath, showMobileTabBar, showMobileBottomInset, showMobileBottomNav };
}
