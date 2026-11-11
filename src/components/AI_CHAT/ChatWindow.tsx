import { HTPR_7766_CHAT_SHORTCUTS_FLAG } from "@/lib/flags/definitions/htpr-7766-chat-shortcuts";
import { useChatShortcuts } from "@/hooks/MultiPages/AIChat/useChatShortcuts";
import { useContext } from "react";
import { MessageList } from "./MessageList";
import { WelcomeScreen } from "./WelcomeScreen";
import { ChatHeader } from "./ChatHeader";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { AI_Tiptap_Container } from "./AI_Tiptap_Container";
import { cn } from "@/utils/undoActions/helperFuncs";
import { Loader2, X } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8042_AMOLED_CHAT_BORDER_FLAG } from "@/lib/flags/definitions/htpr-8042-amoled-chat-border";
import { HTPR_8055_FLOATING_ELEVATION_FLAG } from "@/lib/flags/definitions/htpr-8055-floating-elevation";
import { HTPR_7764_CHAT_RUNNING_FLAG } from "@/lib/flags/definitions/htpr-7764-chat-running";
import { HTPR_8261_CHAT_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8261-chat-cleanup";
import { HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG } from "@/lib/flags/definitions/htpr-8988-chat-window-layout";
import { HTPR_8334_MULTI_CHAT_WINDOWS_FLAG } from "@/lib/flags/definitions/htpr-8334-multi-chat-windows";

export const ChatWindow = ({ framed = false, primary = false }: { framed?: boolean; primary?: boolean } = {}) => {
  const sideBySide = useFlag(HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG);
  const sharedShortcutsEnabled = useFlag(HTPR_7766_CHAT_SHORTCUTS_FLAG);
  const isMbl = useContext(MobileViewContext);
  const { currentSession, showWelcomeScreen, minimized, restoreChat, togglePopover, runningSessionIds, chatWindows } =
    useAiChatContext();
  const shortcuts = useChatShortcuts({
    enabled: sharedShortcutsEnabled,
    ...(chatWindows?.enabled && !isMbl ? { onNewChat: chatWindows.openNewChatWindow } : {}),
  });
  const amoledChatBorder = useFlag(HTPR_8042_AMOLED_CHAT_BORDER_FLAG);
  const floatingElevation = useFlag(HTPR_8055_FLOATING_ELEVATION_FLAG);
  const multiChatWindowsEnabled = useFlag(HTPR_8334_MULTI_CHAT_WINDOWS_FLAG);
  const windowFramed = framed && multiChatWindowsEnabled;
  const chatRunningEnabled = useFlag(HTPR_7764_CHAT_RUNNING_FLAG);
  const chatCleanupEnabled = useFlag(HTPR_8261_CHAT_CLEANUP_FLAG);

  if (minimized)
    return (
      <>
      {shortcuts.modal}
      <button
        type="button"
        ref={shortcuts.surfaceRef} data-ai-chat-surface={shortcuts.enabled ? "floating" : undefined}
        onKeyDownCapture={sharedShortcutsEnabled ? shortcuts.onKeyDownCapture : undefined}
        onClick={restoreChat}
        className={cn("group flex items-center gap-2 border-x border-t border-border-light-gray-thin bg-ai-chat px-3 py-2 text-white-black shadow-[0_-8px_30px_rgba(0,0,0,0.45)] rounded-t-[4px]", sideBySide && "shrink-0")}
      >
        <span className="max-w-[160px] truncate text-meta font-medium">
          {currentSession?.title ?? "AI Chat"}
        </span>
        {chatRunningEnabled && currentSession && runningSessionIds.includes(currentSession.id) && (
          <Loader2 size={14} className="shrink-0 animate-spin" role="status" aria-label="Chat running" />
        )}
        <span
          role="button"
          aria-label="Close AI chat"
          onClick={(event) => {
            event.stopPropagation();
            togglePopover();
          }}
          className="text-icon-dark-gray hover:text-white-black"
        >
          <X size={14} strokeWidth={1.75} />
        </span>
      </button>
      </>
    );

  return (
    <div
      ref={shortcuts.surfaceRef} data-ai-chat-surface={shortcuts.enabled ? "floating" : undefined}
      onKeyDownCapture={sharedShortcutsEnabled ? shortcuts.onKeyDownCapture : undefined}
      tabIndex={shortcuts.enabled ? -1 : undefined}
      className={cn(
        "bg-ai-chat text-meta flex flex-col overflow-hidden chatwindow",
        !isMbl && multiChatWindowsEnabled && "[--bs-border-radius:4px]",
        amoledChatBorder && !isMbl && "[outline:var(--outline-floating-panel)] [outline-offset:var(--offset-floating-panel-outline)]",
        amoledChatBorder && !isMbl && !multiChatWindowsEnabled && "[--bs-border-radius:var(--radius-chat-window)]",
        isMbl || windowFramed
          ? "h-full min-h-0 w-full flex-1 rounded-none"
          : cn("h-[70svh] max-h-[calc(100svh-1rem)] w-[30vw] min-w-[360px] max-w-[calc(100vw-1rem)]", chatCleanupEnabled ? "rounded-[4px]" : "rounded"),
        !isMbl && !windowFramed && floatingElevation && "shadow-floating"
      )}
      style={{
        boxShadow:
          isMbl || windowFramed || floatingElevation
            ? undefined
            : "var(--shadow-floating-previous)",
      }}
    >
      {shortcuts.modal}
      <ChatHeader windowDrag={windowFramed} allowDocking={(sideBySide && primary) || !windowFramed} />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {showWelcomeScreen ? <WelcomeScreen /> : <MessageList />}
      </div>
      <AI_Tiptap_Container />
    </div>
  );
};
