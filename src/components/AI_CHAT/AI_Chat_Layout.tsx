import React, { useContext, useEffect, useRef } from "react";
import type { ChatContextType } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { useOptionalAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilState } from "@/lib/state";
import { showQuickTipsAtom } from "@/store";
import { cn } from "@/utils/undoActions/helperFuncs";
import { ChevronLeft } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
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
    /**
     * Back-press handshake with the Android shell. Any surface that can be
     * dismissed registers this while it's open and returns true once it has
     * closed itself; the shell only falls back to page-back / exiting the app
     * when it's absent or returns false.
     */
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

// Clear the dock when it's showing. While typing the dock hides and publishes
// --mobile-dock-h: 0px, so this collapses and the composer sits right above the
// keyboard. Default 64px only applies before the dock has measured.
const aiChatMobileComposerPad = "pb-[var(--mobile-dock-h,64px)]";

/**
 * The chat's own UI (sidebar, mobile sheet, floating window, rename modal and
 * the desktop "open chat" chevron). It renders beside the page inside
 * AI_Chat_Closed_Layout, never around it: wrapping the page made React rebuild
 * the whole route the moment chat loaded, so an open board lost its columns
 * and refetched (HTPR-6751).
 */
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
  const { toggleAIChatInterface } = useGlobalUIState();

  // Android back closes the mobile chat. The chat is an overlay, not a route, so
  // the app shell can't tell from history whether back should dismiss something
  // or leave the page — pushing a fake history entry to fake it proved unreliable
  // (back still exited the app). Instead the shell ASKS the page: on back press it
  // calls window.__htHandleBack(), and only does its own thing when that returns
  // false. Registering here means back dismisses the chat exactly while it's open.
  const togglePopoverRef = useRef(togglePopover);
  togglePopoverRef.current = togglePopover;
  useEffect(() => {
    if (!isMbl || !showAiChatInterface) return;
    // Keep any handler already registered by an overlay above/below this one and
    // restore it on close, so nested dismissables unwind in order.
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
            // Show the grab bar rather than the collapsed, disableDrag header this
            // used: that header removed both the visual affordance AND swipe-down
            // to dismiss, which (with the dock hidden) left the chat with no exit.
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
      {/* Chat closed on desktop: mirror of the collapsed rail's ">" expand
          chevron, on the opposite edge. Same size, same top, same quiet style. */}
      {!showAiChatInterface && !isMbl && (
        <button
          tabIndex={-1}
          onClick={toggleAIChatInterface}
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
              panelClassName={cn(mobileOverlayAppSheetPanelClass)}
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
