"use client";

import React, { useContext, useEffect } from "react";
import { useRecoilState } from "@/lib/state";
import { MessageList } from "./MessageList";
import { WelcomeScreen } from "./WelcomeScreen";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { ChatHeader } from "./ChatHeader";
import { AI_Tiptap_Container } from "./AI_Tiptap_Container";
import { AiChatSidebarResizeHandle } from "./AiChatSidebarResizeHandle";
import { aiChatSidebarWidthPxAtom } from "@/store";
import { AI_CHAT_SIDEBAR_MIN_PX } from "@/lib/configs/style.config";
import { cn } from "@/utils/undoActions/helperFuncs";

export const AI_Chat_Sidebar = ({
  inOffcanvas = false,
}: {
  inOffcanvas?: boolean;
}) => {
  const { showWelcomeScreen, minimized } = useAiChatContext();
  const isMbl = useContext(MobileViewContext);
  const [sidebarWidthPx] = useRecoilState(aiChatSidebarWidthPxAtom);

  const desktopWidthStyle =
    !inOffcanvas && !isMbl
      ? {
          width: Math.max(sidebarWidthPx, AI_CHAT_SIDEBAR_MIN_PX),
          flexShrink: 0 as const,
        }
      : undefined;

  const publishedWidthPx = desktopWidthStyle?.width ?? 0;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ht-ai-sidebar-width", `${publishedWidthPx}px`);
    return () => {
      root.style.setProperty("--ht-ai-sidebar-width", "0px");
    };
  }, [publishedWidthPx]);

  return (
    <div
      data-ai-chat-panel
      data-testid="ai-sidebar"
      className={cn(
        "ai-chat-sidebar bg-ai-chat flex sticky top-0 min-h-0 min-w-0 text-white-black shadow-md",
        inOffcanvas
          ? "h-full min-h-0 w-full flex-col"
          : [
              "h-SVH-full z-[51] max-md:fixed max-md:inset-0 max-md:z-[9991] max-md:w-full",
              "flex-col md:flex-row md:shrink-0",
            ]
      )}
      style={desktopWidthStyle}
    >
      {!inOffcanvas && !isMbl && <AiChatSidebarResizeHandle />}

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col border-l-thin border-[#434343]"
        )}
      >
        <ChatHeader />

        {!minimized && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
              {showWelcomeScreen ? <WelcomeScreen /> : <MessageList />}
            </div>

            <AI_Tiptap_Container />
          </div>
        )}
      </div>
    </div>
  );
};
