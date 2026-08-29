"use client";

import { useContext, useMemo } from "react";
import { useRecoilValue } from "@/lib/state";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import {
  aiChatSidebarWidthPxAtom,
  isAiChatSidebarModeAtom,
  showAIChatInterfaceAtom,
} from "@/store";
import { aiChatMainContentWidthCalc } from "@/lib/configs/style.config";

/**
 * Shared layout values for fixed UI (board header, bottom tips bar, floating controls)
 * that must align with the main content area when the AI chat panel is open in sidebar mode.
 *
 * Main-column reflow (task detail vs wide sidebar) uses CSS container queries on the layout
 * column (`@container` in AI_Chat_Layout / TaskDetailMainContainer), not this hook.
 * `MobileViewContext` remains for real small viewports (e.g. sheet chat, device-level UX).
 */
export function useAiChatMainContentLayout() {
  const isMbl = useContext(MobileViewContext);
  const showAiChatInterface = useRecoilValue(showAIChatInterfaceAtom);
  const isSidebarMode = useRecoilValue(isAiChatSidebarModeAtom);
  const sidebarWidthPx = useRecoilValue(aiChatSidebarWidthPxAtom);

  return useMemo(() => {
    const aiSidebarOpen =
      showAiChatInterface && isSidebarMode && !isMbl;

    return {
      /** `width` for fixed full-bleed bars that should stop at the AI sidebar */
      mainContentWidth: aiSidebarOpen
        ? aiChatMainContentWidthCalc(sidebarWidthPx)
        : "100%",
      /** `right` offset in px for fixed elements that sit left of the sidebar */
      sidebarRightOffsetPx: aiSidebarOpen ? sidebarWidthPx : 0,
      aiSidebarOpen,
    };
  }, [
    isMbl,
    isSidebarMode,
    showAiChatInterface,
    sidebarWidthPx,
  ]);
}
