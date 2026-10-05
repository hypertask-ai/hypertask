"use client";

import { useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { useRecoilValue } from "@/lib/state";
import { fcmAtom, currentUserAtom, boardLayoutPreferenceAtom, appShellRailAtom, appShellRailExpandedAtom, showQuickTipsAtom,
  showEmptyViewTabsAtom, hiddenViewTabIdsAtom, viewTabsOrderAtom, tableVisibleColumnsAtom, tableColumnWidthsAtom,
  tableTitleWrapAtom, openAiChatByDefaultAtom, aiChatAutoOpenSuppressedAtom, aiChatPinnedAtom } from "@/store";
import { BOARD_FIRST_SCREEN_FLAG } from "./boardDocument";
import { BOARD_DISPLAY_COOKIE, parseBoardDisplay } from "./boardDisplay";

export default function BoardDisplayMirror({ accountId }: { accountId: number | null }) {
  const enabled = useFlag(BOARD_FIRST_SCREEN_FLAG);
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
  const openChat = useRecoilValue(openAiChatByDefaultAtom);
  const chatSuppressed = useRecoilValue(aiChatAutoOpenSuppressedAtom);
  const chatPinned = useRecoilValue(aiChatPinnedAtom);
  useEffect(() => {
    if (!enabled || accountId === null || user?.id !== accountId) return;
    const mirror = () => {
      const theme = document.documentElement.dataset.theme;
      const value = JSON.stringify({ version: 1, accountId, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: navigator.language, boardLayout, theme, railCollapsed, quickTips, draftsFirst: false,
        isMobile: window.innerWidth < 768,
        inbox: { nudgeDismissed: localStorage.getItem("ht_inbox_notif_nudge_dismissed") === "true",
          pushPermission: fcm.permissionStatus, pushEnabled: fcm.statusToggleFromDB === "true" },
        board: { railOn, showEmptyViewTabs, hiddenViewTabIds, viewTabsOrder, tableColumns, tableWidths, tableTitleWrap, openChat, chatSuppressed, chatPinned } });
      const encoded = encodeURIComponent(value);
      const valid = encoded.length <= 3800 && parseBoardDisplay(value, accountId);
      document.cookie = `${BOARD_DISPLAY_COOKIE}=${valid ? encoded : ""}; Path=/; Max-Age=${valid ? 604800 : 0}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    };
    mirror();
    window.addEventListener("resize", mirror);
    window.addEventListener("pagehide", mirror);
    window.addEventListener("ht-inbox-display-change", mirror);
    const themes = new MutationObserver(mirror);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { window.removeEventListener("resize", mirror); window.removeEventListener("pagehide", mirror); window.removeEventListener("ht-inbox-display-change", mirror); themes.disconnect(); };
  }, [enabled, accountId, user?.id, fcm.permissionStatus, fcm.statusToggleFromDB, boardLayout, railOn, railCollapsed, quickTips, showEmptyViewTabs, hiddenViewTabIds,
    viewTabsOrder, tableColumns, tableWidths, tableTitleWrap, openChat, chatSuppressed, chatPinned]);
  return null;
}
