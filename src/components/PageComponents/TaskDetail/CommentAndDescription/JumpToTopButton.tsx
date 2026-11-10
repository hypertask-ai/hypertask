"use client";
import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8998_JUMP_TO_TOP_FLAG } from "@/lib/flags/definitions/htpr-8998-jump-to-top";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import { cn } from "@/utils/undoActions/helperFuncs";

const SHOW_AFTER_PX = 200;

const JumpToTopButton = () => {
  const jumpToTop = useFlag(HTPR_8998_JUMP_TO_TOP_FLAG);
  const { focusOn, scrollVirtualize, virtualizer } = useTaskContext();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!jumpToTop) return;
    const target: Window | Element = virtualizer.scrollElement ?? window;
    const sync = () =>
      setScrolled((target === window ? window.scrollY : (target as Element).scrollTop) > SHOW_AFTER_PX);
    sync();
    target.addEventListener("scroll", sync, { passive: true });
    return () => target.removeEventListener("scroll", sync);
  }, [jumpToTop, virtualizer]);

  if (!jumpToTop) return null;

  return (
    <div className="sticky bottom-6 z-10 h-0 self-end">
      <button
        type="button"
        data-testid="jump-to-top"
        aria-label="Jump to top"
        tabIndex={scrolled ? 0 : -1}
        onClick={() => {
          focusOn(descriptionContainerId, false);
          scrollVirtualize("description");
        }}
        className={cn(
          "group absolute bottom-0 left-4 flex h-8 w-8 items-center justify-center rounded-[4px] bg-active-elementBg transition-opacity",
          scrolled ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <ArrowUp size={18} strokeWidth={1.75} className="text-text-light-gray transition-colors group-hover:text-white-black" />
        <Tooltip left={0} bottom={40} text="Jump to top" keyCombination={["G", "G"]} />
      </button>
    </div>
  );
};

export default JumpToTopButton;
