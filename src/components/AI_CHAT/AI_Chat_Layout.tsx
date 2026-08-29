import React, { useContext, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useRecoilState } from "@/lib/state";
import { showQuickTipsAtom } from "@/store";
import { cn } from "@/utils/undoActions/helperFuncs";
import { ChevronLeft } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";

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

/** Styling for `AppSheet` used in this layout (kept here, not in `AppSheet`). */
const aiChatAppSheetPanelClass = cn(
  "!bg-ai-chat text-white-black p-0 shadow-[0_-12px_40px_rgba(0,0,0,0.45)]",
  "rounded-t-2xl border-t border-border-light-gray-thin",
  "border-thin border-border-light-gray-thin",
  // A real bottom sheet, not a full-screen takeover: stop short of the top so
  // the page shows behind it. That gives the sheet somewhere to slide down to,
  // a backdrop to tap, and keeps its grab bar clear of the app top bar (which is
  // opaque and higher, and used to cover the chat's own header + close button).
  "!max-h-[85svh] h-[85svh]"
);

const aiChatAppSheetBodyClass = cn(
  "flex min-h-0 flex-1 flex-col overflow-hidden p-0",
  "pb-[env(safe-area-inset-bottom)]"
);

// Below the mobile tab bar (z-300); the bar stays visible and tappable so it
// remains the way out of the chat (it only hides while the keyboard is up).
const AI_CHAT_MOBILE_Z = 280;
// Clear the dock when it's showing. While typing the dock hides and publishes
// --mobile-dock-h: 0px, so this collapses and the composer sits right above the
// keyboard. Default 64px only applies before the dock has measured.
const aiChatMobileComposerPad = "pb-[var(--mobile-dock-h,64px)]";

const aiChatAppSheetHandleHeaderClass =
  "!shadow-none !bg-transparent shrink-0";
const aiChatAppSheetHandleRowClass =
  "flex w-full shrink-0 flex-col items-center pt-2 pb-1";
const aiChatAppSheetHandleBarClass = "h-1 w-10 rounded-full bg-white-black/25";

interface AI_Chat_LayoutProps {
  children: React.ReactNode;
  /** Mobile shell (top bar) is mounted — reserve the top-bar inset. */
  mobileTopBarVisible?: boolean;
  /** Bottom dock is mounted — reserve the dock inset. Off on the detail page. */
  mobileTabBarVisible?: boolean;
  mobilePullCommandEnabled?: boolean;
}

const AI_Chat_Layout: React.FC<AI_Chat_LayoutProps> = ({
  children,
  mobileTopBarVisible = false,
  mobileTabBarVisible = false,
  mobilePullCommandEnabled = false,
}) => {
  const pathname = usePathname();
  const isMbl = useContext(MobileViewContext);
  const [showQuickTips] = useRecoilState(showQuickTipsAtom);
  const {
    isSidebarMode,
    showAiChatInterface,
    isDetailPage,
    showRenameChatModal,
    renameChat,
    sessions,
    togglePopover,
  } = useAiChatContext();
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
  if (isDetailPage && isMbl && !showAiChatInterface) {
    return (
      <div
        data-ai-workspace
        tabIndex={-1}
        className={cn(
          "outline-none",
          // Top-bar inset + shell scope stay whenever the top bar is mounted.
          mobileTopBarVisible &&
            "mobile-tab-bar-content pt-[var(--mobile-top-bar-h)]",
          // The dock is hidden on detail, so its inset only applies if it's up.
          mobileTabBarVisible && "pb-[var(--mobile-dock-h,64px)]",
          mobilePullCommandEnabled && "mobile-pull-command-enabled"
        )}
      >
        {children}
      </div>
    );
  }
  // Settings is a full-screen surface that overlays everything; the AI chat
  // panel must not sit beside it (Valentin, HTPR-4391 follow-up).
  if (pathname?.startsWith("/settings")) return (<>{children}</>)
  return (
    <div className={`flex ${!isDetailPage ? "h-screen" : ""}`}>
      <div
        data-ai-workspace
        tabIndex={-1}
        className={cn(
          "@container min-w-0 flex-1 outline-none",
          !isDetailPage && "overflow-x-auto",
          // Top-bar inset + shell scope follow the top bar; the dock inset is
          // separate so the detail page (dock hidden) keeps its top inset.
          mobileTopBarVisible &&
            "mobile-tab-bar-content pt-[var(--mobile-top-bar-h)]",
          mobileTabBarVisible && "pb-[var(--mobile-dock-h,64px)]",
          mobilePullCommandEnabled && "mobile-pull-command-enabled"
        )}
      >
        {children}
      </div>
      <React.Suspense fallback={null}>
        {showAiChatInterface && isSidebarMode && isMbl && (
          <AppSheet
            onClose={togglePopover}
            ariaLabel="AI Chat"
            // Show the grab bar rather than the collapsed, disableDrag header this
            // used: that header removed both the visual affordance AND swipe-down
            // to dismiss, which (with the dock hidden) left the chat with no exit.
            defaultLibraryHeader={false}
            zIndex={AI_CHAT_MOBILE_Z}
            panelClassName={cn(aiChatAppSheetPanelClass)}
            bodyClassName={cn(aiChatAppSheetBodyClass, "h-full", aiChatMobileComposerPad)}
            headerClassName={aiChatAppSheetHandleHeaderClass}
            handleRowClassName={aiChatAppSheetHandleRowClass}
            handleBarClassName={aiChatAppSheetHandleBarClass}
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
              zIndex={AI_CHAT_MOBILE_Z}
              panelClassName={cn(aiChatAppSheetPanelClass)}
              bodyClassName={cn(aiChatAppSheetBodyClass, aiChatMobileComposerPad)}
              headerClassName={aiChatAppSheetHandleHeaderClass}
              handleRowClassName={aiChatAppSheetHandleRowClass}
              handleBarClassName={aiChatAppSheetHandleBarClass}
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
            currentTitle={sessions[0]?.title ?? ""}
            closeCallback={renameChat}
          />
        )}
      </React.Suspense>
    </div>
  );
};

export default AI_Chat_Layout;
