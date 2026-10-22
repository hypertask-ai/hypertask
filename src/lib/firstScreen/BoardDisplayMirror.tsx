"use client";

import { useEffect, useLayoutEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { useHydrated } from "@/hooks/General/useHydrated";
import { useRecoilValue } from "@/lib/state";
import { fcmAtom, currentUserAtom, boardLayoutPreferenceAtom, appShellRailAtom, appShellRailExpandedAtom, showQuickTipsAtom,
  showEmptyViewTabsAtom, hiddenViewTabIdsAtom, viewTabsOrderAtom, tableVisibleColumnsAtom, tableColumnWidthsAtom,
  tableTitleWrapAtom, openAiChatByDefaultAtom, keepAiChatClosedAtom, aiChatAutoOpenSuppressedAtom, aiChatPinnedAtom, aiChatSidebarWidthPxAtom, isAiChatSidebarModeAtom } from "@/store";
import { HTPR_7406_DESKTOP_SERVER_BOARD_FLAG } from "@/lib/flags/keys";
import { BOARD_FIRST_SCREEN_FLAG } from "./boardDocument";
import { BOARD_DISPLAY_COOKIE, parseBoardDisplay } from "./boardDisplay";

export default function BoardDisplayMirror({ accountId }: { accountId: number | null }) {
  const enabled = useFlag(BOARD_FIRST_SCREEN_FLAG);
  const desktopChat = useFlag(HTPR_7406_DESKTOP_SERVER_BOARD_FLAG);
  const hydrated = useHydrated();
  const user = useRecoilValue(currentUserAtom);
  const fcm = useRecoilValue(fcmAtom);
  const boardLayout = useRecoilValue(boardLayoutPreferenceAtom);
  const railOn = useRecoilValue(appShellRailAtom);
  const railCollapsed = !useRecoilValue(appShellRailExpandedAtom);
  const quickTips = useRecoilValue(showQuickTipsAtom);
  const showEmptyViewTabs = useRecoilValue(showEmptyViewTabsAtom);
  const hiddenViewTabIds = useRecoilValue(hiddenViewTabIdsAtom);
  const viewTabsOrder = useRecoilValue(viewTabsOrderAtom);
  const tableColumns = useRecoilValue(tableVisibleColumnsAtom);
  const tableWidths = useRecoilValue(tableColumnWidthsAtom);
  const tableTitleWrap = useRecoilValue(tableTitleWrapAtom);
  const keepChatClosed = useRecoilValue(keepAiChatClosedAtom);
  const openChat = useRecoilValue(openAiChatByDefaultAtom);
  const chatSuppressed = useRecoilValue(aiChatAutoOpenSuppressedAtom);
  const chatPinned = useRecoilValue(aiChatPinnedAtom);
  const chatWidth = useRecoilValue(aiChatSidebarWidthPxAtom);
  const chatSidebarMode = useRecoilValue(isAiChatSidebarModeAtom);
  useLayoutEffect(() => {
    if (!hydrated) return;
    document.documentElement.removeAttribute("data-ticket-sidebar");
    document.documentElement.style.removeProperty("--ticket-sidebar-width");
  }, [hydrated]);
  useEffect(() => {
    if (!enabled || accountId === null || user?.id !== accountId) return;
    const mirror = () => {
      let nudgeDismissed: boolean;
      try {
        nudgeDismissed = localStorage.getItem("ht_inbox_notif_nudge_dismissed") === "true";
      } catch {
        document.cookie = `${BOARD_DISPLAY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
        return;
      }
      const theme = document.documentElement.dataset.theme;
      const value = JSON.stringify({ version: 1, accountId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: navigator.language, boardLayout, theme, railCollapsed, quickTips, draftsFirst: false,
        isMobile: window.innerWidth < 768,
        inbox: { nudgeDismissed,
          pushPermission: fcm.permissionStatus, pushEnabled: fcm.statusToggleFromDB === "true" },
        board: { railOn, showEmptyViewTabs, hiddenViewTabIds, viewTabsOrder, tableColumns, tableWidths, tableTitleWrap, openChat, keepChatClosed, chatSuppressed, chatPinned, chatWidth, chatSidebarMode } });
      const encoded = encodeURIComponent(value);
      const valid = encoded.length <= 3800 && parseBoardDisplay(value, accountId, { desktopChat });
      document.cookie = `${BOARD_DISPLAY_COOKIE}=${valid ? encoded : ""}; Path=/; Max-Age=${valid ? 604800 : 0}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    };
    mirror();
    window.addEventListener("resize", mirror);
    window.addEventListener("pagehide", mirror);
    window.addEventListener("ht-inbox-display-change", mirror);
    const themes = new MutationObserver(mirror);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { window.removeEventListener("resize", mirror); window.removeEventListener("pagehide", mirror); window.removeEventListener("ht-inbox-display-change", mirror); themes.disconnect(); };
  }, [enabled, desktopChat, accountId, user?.id, fcm.permissionStatus, fcm.statusToggleFromDB, boardLayout, railOn, railCollapsed, quickTips, showEmptyViewTabs, hiddenViewTabIds,
    viewTabsOrder, tableColumns, tableWidths, tableTitleWrap, openChat, keepChatClosed, chatSuppressed, chatPinned, chatWidth, chatSidebarMode]);
  return null;
}
