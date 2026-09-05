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
  /** When true, parent mobile sheet (e.g. AppSheet) fills height; skip fixed layout. */
  inOffcanvas?: boolean;
}) => {
  const { activeSession, currentSession, minimized } = useAiChatContext();
  // While activeSession is set but `currentSession` hasn't resolved yet (a
  // stale/mid-refetch sessions list, HTPR-6100), keep showing the message
  // list instead of flashing the welcome screen over an open conversation.
  const showWelcomeScreen = activeSession
    ? currentSession !== undefined && currentSession.messages.length === 0
    : (currentSession?.messages?.length ?? 0) === 0;
  const isMbl = useContext(MobileViewContext);
  const [sidebarWidthPx] = useRecoilState(aiChatSidebarWidthPxAtom);

  // The stored width predates the current minimum, so anyone who had dragged the panel
  // down to the old 280 floor would stay there. Apply the floor on read rather than
  // migrating the persisted value.
  const desktopWidthStyle =
    !inOffcanvas && !isMbl
      ? {
          width: Math.max(sidebarWidthPx, AI_CHAT_SIDEBAR_MIN_PX),
          flexShrink: 0 as const,
        }
      : undefined;

  // Publish the panel width so fixed-position overlays can centre themselves in the space
  // that is actually left over. The command palette in particular is a reactstrap modal:
  // its outer .modal element takes a className but no inline style, so a CSS variable is
  // the only way to hand it a width that changes at runtime.
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
              {showWelcomeScreen ? (
                <WelcomeScreen />
              ) : (
                <MessageList />
              )}
            </div>

            <AI_Tiptap_Container />
          </div>
        )}
      </div>
    </div>
  );
};
