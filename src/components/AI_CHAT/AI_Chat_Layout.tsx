import React, { useContext, useEffect, useRef } from "react";
import type { ChatContextType } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { useOptionalAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilState } from "@/lib/state";
import { aiChatSidebarWidthPxAtom, showQuickTipsAtom } from "@/store";
import { clampAiChatSidebarWidthPx } from "@/lib/configs/style.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import { ChevronLeft } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8030_CHAT_OPEN_RACE_FLAG } from "@/lib/flags/definitions/htpr-8030-chat-open-race";
import { HTPR_8042_AMOLED_CHAT_BORDER_FLAG } from "@/lib/flags/definitions/htpr-8042-amoled-chat-border";
import {
  MOBILE_OVERLAY_SHEET_Z,
  mobileOverlayAppSheetBodyClass,
  mobileOverlayAppSheetHandleBarClass,
  mobileOverlayAppSheetHandleHeaderClass,
  mobileOverlayAppSheetHandleRowClass,
  mobileOverlayAppSheetPanelClass,
} from "@/components/Modals/Sheets/mobileOverlayAppSheetStyles";

declare global {
  interface Window {
    __htHandleBack?: () => boolean;
  }
}

const AI_Chat_Sidebar = React.lazy(
  () =>
    import("./AI_Chat_Sidebar").then((module) => ({
      default: module.AI_Chat_Sidebar,
    })),
);
const ChatWindow = React.lazy(
  () =>
    import("./ChatWindow").then((module) => ({
      default: module.ChatWindow,
    })),
);
const RenameChatModal = React.lazy(
  () => import("../Modals/AI_Chat/renameChat.modal"),
);
const AppSheet = React.lazy(
  () =>
    import("@/components/Modals/Sheets/AppSheet").then((module) => ({
      default: module.AppSheet,
    })),
);

const aiChatMobileComposerPad = "pb-[var(--mobile-dock-h,64px)]";

const AI_Chat_Panels: React.FC = () => {
  const chat = useOptionalAiChatContext();
  return chat ? <ChatPanelsContent chat={chat} /> : null;
};

const ChatPanelsContent = ({ chat }: { chat: ChatContextType }) => {
  const isMbl = useContext(MobileViewContext);
  const [showQuickTips] = useRecoilState(showQuickTipsAtom);
  const {
    isSidebarMode,
    showAiChatInterface,
    showRenameChatModal,
    renameChat,
    currentSession,
    togglePopover,
  } = chat;
  const idempotentChatOpen = useFlag(HTPR_8030_CHAT_OPEN_RACE_FLAG);
  const amoledChatBorder = useFlag(HTPR_8042_AMOLED_CHAT_BORDER_FLAG);
  const { openAIChatInterface, toggleAIChatInterface } = useGlobalUIState();
  const [, setSidebarWidth] = useRecoilState(aiChatSidebarWidthPxAtom);

  useEffect(() => {
    if (!isMbl || !showAiChatInterface || !isSidebarMode) return;
    setSidebarWidth(width => clampAiChatSidebarWidthPx(width, window.innerWidth));
  }, [isMbl, showAiChatInterface, isSidebarMode, setSidebarWidth]);

  const togglePopoverRef = useRef(togglePopover);
  togglePopoverRef.current = togglePopover;
  useEffect(() => {
    if (!isMbl || !showAiChatInterface) return;
    const previous = window.__htHandleBack;
    window.__htHandleBack = () => {
      togglePopoverRef.current();
      return true;
    };
    return () => {
      window.__htHandleBack = previous;
    };
  }, [isMbl, showAiChatInterface]);
  return (
      <React.Suspense fallback={null}>
        {showAiChatInterface && isSidebarMode && isMbl && (
          <AppSheet
            onClose={togglePopover}
            ariaLabel="AI Chat"
            defaultLibraryHeader={false}
            zIndex={MOBILE_OVERLAY_SHEET_Z}
            panelClassName={cn(mobileOverlayAppSheetPanelClass)}
            bodyClassName={cn(mobileOverlayAppSheetBodyClass, "h-full", aiChatMobileComposerPad)}
            headerClassName={mobileOverlayAppSheetHandleHeaderClass}
            handleRowClassName={mobileOverlayAppSheetHandleRowClass}
            handleBarClassName={mobileOverlayAppSheetHandleBarClass}
          >
            <AI_Chat_Sidebar inOffcanvas />
          </AppSheet>
        )}
      {!showAiChatInterface && !isMbl && (
        <button
          tabIndex={-1}
          onClick={idempotentChatOpen ? openAIChatInterface : toggleAIChatInterface}
          aria-label="Open AI chat"
          className="group fixed right-1 top-2 z-[60] flex h-[20px] items-center justify-center text-text-light-gray hover:text-white-black"
        >
          <ChevronLeft size={16} strokeWidth={1.75} />
          <Tooltip left={-120} bottom={-8} text="AI chat" keyCombination={["5"]} />
        </button>
      )}
        {showAiChatInterface && isSidebarMode && !isMbl && <AI_Chat_Sidebar />}
        {showAiChatInterface && !isSidebarMode && (
        <>
          {isMbl ? (
            <AppSheet
              onClose={togglePopover}
              ariaLabel="AI Chat"
              defaultLibraryHeader={false}
              zIndex={MOBILE_OVERLAY_SHEET_Z}
              panelClassName={cn(
                mobileOverlayAppSheetPanelClass,
                amoledChatBorder && "[.amoled_&]:outline-solid [.amoled_&]:outline-1 [.amoled_&]:-outline-offset-1 [.amoled_&]:outline-[var(--border-light-gray-thin)] [.amoled_&]:!rounded-[5px]",
              )}
              bodyClassName={cn(mobileOverlayAppSheetBodyClass, aiChatMobileComposerPad)}
              headerClassName={mobileOverlayAppSheetHandleHeaderClass}
              handleRowClassName={mobileOverlayAppSheetHandleRowClass}
              handleBarClassName={mobileOverlayAppSheetHandleBarClass}
            >
              <ChatWindow />
            </AppSheet>
          ) : (
            <div
              className={cn(
                "fixed right-[0.5rem] z-[400]",
                showQuickTips ? "bottom-10" : "bottom-5"
              )}
            >
              <ChatWindow />
            </div>
          )}
        </>
      )}
        {showRenameChatModal && (
          <RenameChatModal
            currentTitle={currentSession?.title ?? ""}
            closeCallback={renameChat}
          />
        )}
      </React.Suspense>
  );
};

export default AI_Chat_Panels;
