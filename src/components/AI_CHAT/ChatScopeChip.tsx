import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { ChevronDown, Layers, ListTodo, SquareKanban } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7053_COMPOSE_BOARD_CHIP_FLAG } from "@/lib/flags/keys";

export const ChatScopeChip = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & {
  kind: "task" | "board" | "boards";
  label: string;
  mobile?: boolean;
  isOpen: boolean;
  compose?: boolean;
}>(function ChatScopeChip({ kind, label, mobile = false, isOpen, compose = false, ...props }, ref) {
  const composeBoardChipEnabled = useFlag(HTPR_7053_COMPOSE_BOARD_CHIP_FLAG);
  if (compose && !composeBoardChipEnabled) return null;
  // Compose keeps the compact chip; on phones it only grows to a 44px tap target.
  const chatMobile = mobile && !compose;
  const iconSize = compose ? 14 : 13;
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="menu"
      aria-expanded={isOpen}
      {...props}
      className={`inline-flex w-full min-w-0 items-center text-dense leading-normal text-white-black outline-none transition-colors hover:bg-hover-active ${
        chatMobile
          ? "h-11 max-w-[65vw] rounded-[4px] bg-ai-tiptap px-3"
          : `rounded-[4px] px-2 py-1${compose && mobile ? " min-h-11" : ""}`
      }${compose && composeBoardChipEnabled ? " focus-visible:bg-hover-active" : ""}`}
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
