import { useContext } from "react";
import { MessageList } from "./MessageList";
import { WelcomeScreen } from "./WelcomeScreen";
import { ChatHeader } from "./ChatHeader";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { AI_Tiptap_Container } from "./AI_Tiptap_Container";
import { cn } from "@/utils/undoActions/helperFuncs";
import { Sparkles, X } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8042_AMOLED_CHAT_BORDER_FLAG } from "@/lib/flags/definitions/htpr-8042-amoled-chat-border";

export const ChatWindow = () => {
  const isMbl = useContext(MobileViewContext);
  const amoledChatBorder = useFlag(HTPR_8042_AMOLED_CHAT_BORDER_FLAG);
  const { currentSession, showWelcomeScreen, minimized, restoreChat, togglePopover } =
    useAiChatContext();

  if (minimized)
    return (
      <button
        type="button"
        onClick={restoreChat}
        className="group flex items-center gap-2 rounded-t-lg border-x border-t border-border-light-gray-thin bg-ai-chat px-3 py-2 text-white-black shadow-[0_-8px_30px_rgba(0,0,0,0.45)]"
      >
        <Sparkles size={14} className="text-hypertasks-ai-purple" strokeWidth={1.75} />
        <span className="max-w-[160px] truncate text-meta font-medium">
          {currentSession?.title ?? "AI Chat"}
        </span>
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
    );

  return (
    <div
      className={cn(
        "bg-ai-chat text-meta flex flex-col overflow-hidden chatwindow",
        amoledChatBorder && !isMbl && "[.amoled_&]:outline-solid [.amoled_&]:outline-1 [.amoled_&]:-outline-offset-1 [.amoled_&]:outline-[var(--border-light-gray-thin)] [.amoled_&]:[--bs-border-radius:5px]",
        isMbl
          ? "h-full min-h-0 w-full flex-1 rounded-none"
          : "h-[70svh] max-h-[calc(100svh-1rem)] w-[30vw] min-w-[360px] max-w-[calc(100vw-1rem)] rounded"
      )}
      style={{
        boxShadow: isMbl
          ? undefined
          : "0 0px 75px 45px rgb(0 0 0 / 0.5), var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)",
      }}
    >
      <ChatHeader />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        {showWelcomeScreen ? <WelcomeScreen /> : <MessageList />}
      </div>
      <AI_Tiptap_Container />
    </div>
  );
};
