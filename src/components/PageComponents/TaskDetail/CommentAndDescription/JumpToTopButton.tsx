"use client";
import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8998_JUMP_TO_TOP_FLAG } from "@/lib/flags/definitions/htpr-8998-jump-to-top";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";

const SHOW_AFTER_PX = 200;

function scrollTarget(value: unknown): HTMLElement | Window | null {
  if (value instanceof HTMLElement) return value;
  if (value === window) return window;
  return null;
}

function scrollPosition(target: HTMLElement | Window) {
  if (target instanceof HTMLElement) return target.scrollTop;
  return target.scrollY;
}

const JumpToTopButton = () => {
  const jumpToTop = useFlag(HTPR_8998_JUMP_TO_TOP_FLAG);
  const { focusOn, scrollVirtualize, virtualizer } = useTaskContext();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!jumpToTop) return;
    let detach = () => {};
    let frame = 0;
    let stopped = false;
    const watch = () => {
      if (stopped) return;
      const element = scrollTarget(virtualizer.scrollElement);
      if (!element) {
        frame = window.requestAnimationFrame(watch);
        return;
      }
      const sync = () => setScrolled(scrollPosition(element) > SHOW_AFTER_PX);
      sync();
      element.addEventListener("scroll", sync, { passive: true });
      detach = () => element.removeEventListener("scroll", sync);
    };
    watch();
    return () => {
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      detach();
    };
  }, [jumpToTop, virtualizer]);

  if (!jumpToTop || !scrolled) return null;

  return (
    <div className="sticky bottom-6 z-10 h-0 w-0 self-end">
      <button
        type="button"
        data-testid="jump-to-top"
        aria-label="Jump to top"
        onClick={() => {
          focusOn(descriptionContainerId, false);
          scrollVirtualize("description");
        }}
        className="group absolute bottom-0 left-4 flex h-8 w-8 items-center justify-center rounded-[4px] bg-active-elementBg"
      >
        <ArrowUp size={18} strokeWidth={1.75} className="text-text-light-gray transition-colors group-hover:text-white-black" />
        <Tooltip left={0} bottom={40} text="Jump to top" keyCombination={["G", "G"]} />
      </button>
    </div>
  );
};

export default JumpToTopButton;
