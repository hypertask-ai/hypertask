"use client";

import { useLayoutEffect, useRef } from "react";
import { Circle } from "lucide-react";
import type { InboxTabMeta } from "@/utils/helperFunctions/helperFunctions";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import { useRecoilValue } from "@/lib/state";
import { mobileCommentComposerOpenAtom } from "@/store";

type MobileInboxSplitDockTab = Pick<
  InboxTabMeta,
  "project" | "projectId" | "length" | "hasUnseen"
>;

interface MobileInboxSplitDockProps {
  tabs: MobileInboxSplitDockTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

const MobileInboxSplitDock = ({
  tabs,
  activeIndex,
  onSelect,
}: MobileInboxSplitDockProps) => {
  const dockRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resolvedActiveIndex = tabs[activeIndex] ? activeIndex : 0;
  const { showAiChatInterface } = useGlobalUIState();
  const commentComposerOpen = useRecoilValue(mobileCommentComposerOpenAtom);
  const hidden = showAiChatInterface || commentComposerOpen;

  // This dock replaces the regular mobile navigation on Inbox routes. Publish
  // its real height so the shared app shell reserves exactly the space it uses,
  // including a device's bottom safe area.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (hidden) {
      root.style.setProperty("--mobile-dock-h", "0px");
      return () => root.style.removeProperty("--mobile-dock-h");
    }

    const dock = dockRef.current;
    if (!dock) return;

    const publishHeight = () =>
      root.style.setProperty("--mobile-dock-h", `${dock.offsetHeight}px`);
    publishHeight();

    const observer = new ResizeObserver(publishHeight);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--mobile-dock-h");
    };
  }, [hidden]);

  // Keep a URL-selected or keyboard-selected split visible on narrow screens
  // without moving keyboard focus. Tab and Shift+Tab retain browser order.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const tab = tabRefs.current[resolvedActiveIndex];
    if (!scroller || !tab) return;

    const scrollerBox = scroller.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const delta =
      tabBox.left - scrollerBox.left - (scrollerBox.width - tabBox.width) / 2;
    if (delta) scroller.scrollBy({ left: delta, behavior: "auto" });
  }, [resolvedActiveIndex, tabs.length]);

  const selectFromKeyboard = (index: number) => {
    onSelect(index);
    tabRefs.current[index]?.focus();
  };

  if (hidden) return null;

  return (
    <nav
      ref={dockRef}
      aria-label="Inbox splits"
      className="fixed inset-x-0 bottom-0 z-[300] border-t border-border-light-gray-thin bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div
        ref={scrollerRef}
        role="tablist"
        aria-label="Choose inbox split"
        className="flex h-16 items-stretch overflow-x-auto overscroll-x-contain px-2 scrollbar-none"
      >
        {tabs.map((tab, index) => {
          const active = resolvedActiveIndex === index;
          return (
            <button
              key={`${tab.projectId ?? "automatic"}-${tab.project}-${index}`}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => {
                let nextIndex: number | undefined;
                if (event.key === "ArrowRight") {
                  nextIndex = (index + 1) % tabs.length;
                } else if (event.key === "ArrowLeft") {
                  nextIndex = (index - 1 + tabs.length) % tabs.length;
                } else if (event.key === "Home") {
                  nextIndex = 0;
                } else if (event.key === "End") {
                  nextIndex = tabs.length - 1;
                }
                if (nextIndex === undefined) return;
                event.preventDefault();
                selectFromKeyboard(nextIndex);
              }}
              className={cn(
                "relative flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1 border-t-2 px-2 text-dense font-medium outline-none",
                "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white-black",
                active
                  ? "border-white-black text-white-black"
                  : "border-transparent text-text-light-gray",
              )}
            >
              <span>{tab.project}</span>
              {tab.length > 0 && (
                <span className="text-meta font-normal text-text-light-gray">
                  {tab.length}
                </span>
              )}
              {!tab.hasUnseen && (
                <Circle
                  size={7}
                  aria-label="Unread"
                  className="h-[7px] w-[7px] fill-current text-[#5896F1]"
                  strokeWidth={1.75}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileInboxSplitDock;
