"use client";
import { useEffect, useState, type RefObject } from "react";
import { ChevronUp } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8998_TICKET_JUMP_TO_TOP_FLAG } from "@/lib/flags/definitions/htpr-8998-ticket-jump-to-top";
import { scrollTicketToTop, ticketShowsJumpToTop } from "@/lib/taskDetailJumpToTop";

type JumpToTopButtonProps = {
  scrollElementRef?: RefObject<HTMLDivElement | null>;
};

const JumpToTopButton = ({ scrollElementRef }: JumpToTopButtonProps) => {
  const jumpToTop = useFlag(HTPR_8998_TICKET_JUMP_TO_TOP_FLAG);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!jumpToTop) return;
    const element = scrollElementRef?.current;
    const readOffset = () =>
      element ? element.scrollTop : window.scrollY || document.documentElement.scrollTop;
    const sync = () => setScrolled(ticketShowsJumpToTop(readOffset()));
    sync();
    if (element) element.addEventListener("scroll", sync, { passive: true });
    else window.addEventListener("scroll", sync, { passive: true });
    return () => {
      if (element) element.removeEventListener("scroll", sync);
      else window.removeEventListener("scroll", sync);
    };
  }, [jumpToTop, scrollElementRef]);

  if (!jumpToTop || !scrolled) return null;

  return (
    <button
      type="button"
      aria-label="Jump to top"
      aria-keyshortcuts="g g"
      data-testid="jump-to-top"
      onClick={() => scrollTicketToTop(scrollElementRef?.current ?? window)}
      style={{ right: "calc(var(--ht-ai-sidebar-width, 0px) + 16px)" }}
      className="group fixed bottom-4 z-floating flex h-8 w-8 cursor-pointer items-center justify-center rounded-[4px] border border-border-light-gray-thin bg-back-button text-button-arrow shadow-md hover:bg-hover-active"
    >
      <ChevronUp size={18} strokeWidth={1.75} aria-hidden />
      <Tooltip left={0} bottom={40} text="Jump to top" keyCombination={["G G"]} />
    </button>
  );
};

export default JumpToTopButton;
