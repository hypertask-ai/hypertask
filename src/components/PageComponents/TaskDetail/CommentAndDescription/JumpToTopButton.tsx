"use client";
import { ArrowUp } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8998_JUMP_TO_TOP_FLAG } from "@/lib/flags/definitions/htpr-8998-jump-to-top";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { cn } from "@/utils/undoActions/helperFuncs";

const JumpToTopButton = () => {
  const jumpToTop = useFlag(HTPR_8998_JUMP_TO_TOP_FLAG);
  const { showScrollToTop, focusOn, scrollVirtualize } = useTaskContext();
  if (!jumpToTop) return null;

  return (
    <div className="sticky bottom-6 z-10 h-0 self-end">
      <button
        type="button"
        data-testid="jump-to-top"
        aria-label="Jump to top"
        tabIndex={showScrollToTop ? 0 : -1}
        onClick={() => {
          focusOn(descriptionContainerId, false);
          scrollVirtualize("description");
        }}
        className={cn(
          "group absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-[4px] bg-active-elementBg transition-opacity",
          showScrollToTop ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ArrowUp size={18} strokeWidth={1.75} className="text-text-light-gray transition-colors group-hover:text-white-black" />
        <Tooltip left={-104} bottom={40} text="Jump to top" keyCombination={["G", "G"]} />
      </button>
    </div>
  );
};

export default JumpToTopButton;
