import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { ChevronDown, Layers, ListTodo, SquareKanban } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8032_PHONE_CHAT_FULLSCREEN_FLAG } from "@/lib/flags/definitions/htpr-8032-phone-chat-fullscreen";

export const ChatScopeChip = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & {
  kind: "task" | "board" | "boards";
  label: string;
  mobile?: boolean;
  isOpen: boolean;
  compose?: boolean;
  compact?: boolean;
}>(function ChatScopeChip({ kind, label, mobile = false, isOpen, compose = false, compact = false, ...props }, ref) {
  const phoneChatFullscreen = useFlag(HTPR_8032_PHONE_CHAT_FULLSCREEN_FLAG);
  const small = compact && phoneChatFullscreen;
  const chatMobile = mobile && !compose && !small;
  const iconSize = compose ? 14 : 13;
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      {...props}
      className={small
        ? "inline-flex w-auto max-w-32 min-w-0 items-center rounded-[4px] px-2 py-1 text-dense leading-normal text-white-black outline-none transition-colors hover:bg-hover-active"
        : `inline-flex w-full min-w-0 items-center text-dense leading-normal text-white-black outline-none transition-colors hover:bg-hover-active ${
        chatMobile
          ? "h-11 max-w-[65vw] rounded-[4px] bg-ai-tiptap px-3"
          : `rounded-[4px] px-2 py-1${compose && mobile ? " min-h-11" : ""}`
      }${compose ? " focus-visible:bg-hover-active" : ""}`}
    >
      {chatMobile && (
        <span className="mr-1 flex-none text-text-light-gray">Context:</span>
      )}
      <span className="mr-1 flex-none text-text-light-gray">
        {kind === "task" ? (
          <ListTodo size={iconSize} strokeWidth={1.75} />
        ) : kind === "boards" ? (
          <Layers size={iconSize} strokeWidth={1.75} />
        ) : (
          <SquareKanban size={iconSize} strokeWidth={1.75} />
        )}
      </span>
      <span className="min-w-0 truncate font-medium">{label}</span>
      <ChevronDown
        size={16}
        className={`ml-1 flex-none text-emphasis text-text-light-gray transition-transform ${isOpen ? "rotate-180" : ""}`}
        strokeWidth={1.75}
      />
    </button>
  );
});
