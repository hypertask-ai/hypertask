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

export function useAiChatMainContentLayout() {
  const isMbl = useContext(MobileViewContext);
  const showAiChatInterface = useRecoilValue(showAIChatInterfaceAtom);
  const isSidebarMode = useRecoilValue(isAiChatSidebarModeAtom);
  const sidebarWidthPx = useRecoilValue(aiChatSidebarWidthPxAtom);

  return useMemo(() => {
    const aiSidebarOpen =
      showAiChatInterface && isSidebarMode && !isMbl;

    return {
      mainContentWidth: aiSidebarOpen
        ? aiChatMainContentWidthCalc(sidebarWidthPx)
        : "100%",
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
