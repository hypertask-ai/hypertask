import React from "react";
import Markdown from "react-markdown";
import { ChevronDown } from "lucide-react";

import { AppSheet } from "./AppSheet";
import { createTapGuard } from "@/lib/utils/deliberateTap";
import { summaryTeaser } from "@/components/PageComponents/TaskDetail/TopRow/TaskSummary";
import "@/styles/task/taskSummary.scss";

interface IProps {
  markdown: string;
}

export const TaskSummaryMobile: React.FC<IProps> = ({ markdown }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const closeSummary = React.useCallback(() => setIsOpen(false), []);

  const [perfDebug, setPerfDebug] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const perfParam = new URLSearchParams(window.location.search).get("perf");
    let stored = false;
    try {
      if (perfParam === "1") window.localStorage.setItem("ht_perf", "1");
      else if (perfParam === "0") window.localStorage.removeItem("ht_perf");
      stored = window.localStorage.getItem("ht_perf") === "1";
    } catch {
    }
    setPerfDebug(perfParam === "1" || stored);
  }, []);

  const tapTimeRef = React.useRef<number | null>(null);
  const openCountRef = React.useRef(0);
  const [perfBadge, setPerfBadge] = React.useState<{ count: number; ms: number } | null>(null);

  const openSummary = React.useCallback(() => {
    tapTimeRef.current = typeof performance !== "undefined" ? performance.now() : null;
    setIsOpen(true);
  }, []);

  const tap = React.useRef(createTapGuard()).current;
  const onTouchStart = React.useCallback(
    (event: React.TouchEvent) => {
      const touch = event.touches[0];
      if (touch) tap.start(touch.clientX, touch.clientY);
    },
    [tap]
  );
  const onTouchMove = React.useCallback(
    (event: React.TouchEvent) => {
      const touch = event.touches[0];
      if (touch) tap.move(touch.clientX, touch.clientY);
    },
    [tap]
  );
  const onTeaserClick = React.useCallback(() => {
    if (tap.isStray()) return;
    openSummary();
  }, [openSummary, tap]);

  React.useEffect(() => {
    if (!isOpen || !perfDebug || tapTimeRef.current == null) return;
    const tapTime = tapTimeRef.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        openCountRef.current += 1;
        setPerfBadge({ count: openCountRef.current, ms: Math.round(performance.now() - tapTime) });
      });
    });
  }, [isOpen, perfDebug]);

  const [warm, setWarm] = React.useState(false);
  const [warmDone, setWarmDone] = React.useState(false);

  React.useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => setWarm(true));
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(() => setWarm(true), 300);
    return () => clearTimeout(id);
  }, []);

  React.useEffect(() => {
    if (!warm) return;
    const id = setTimeout(() => {
      setWarm(false);
      setWarmDone(true);
    }, 400);
    return () => clearTimeout(id);
  }, [warm]);

  React.useEffect(() => {
    if (isOpen) {
      setWarm(false);
      setWarmDone(true);
    }
  }, [isOpen]);

  return (
    <>
      {perfDebug && perfBadge && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100000,
            pointerEvents: "none",
            background: "rgba(0,0,0,0.8)",
            color: "#fff",
            fontSize: 12,
            padding: "4px 10px",
            borderRadius: 999,
          }}
        >
          open #{perfBadge.count}: {perfBadge.ms}ms
        </div>
      )}
      <button
        type="button"
        onClick={onTeaserClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        className="flex py-2 border-y border-light-black-border-1 text-text-light-gray gap-1 w-full justify-start items-center group cursor-pointer appearance-none bg-transparent text-left touch-manipulation select-none"
      >
        <span className="font-medium headline line-clamp-1 text-content w-fit ">
          {summaryTeaser(markdown)}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} className="text-content" />
      </button>
      <AppSheet
        disableScrollLocking
        sheetStyle={{ }}
        isOpen={isOpen}
        onClose={closeSummary}
        ariaLabel="Task summary"
        panelClassName="min-h-[30vh] markdown-sheet bg-taskDetal-container"
        containerStyle={{ height: "fit-content" }}
        bodyClassName="p-3 overflow-y-auto text-white-black"
      >
        <div className="flex flex-col">
          <h3 className="text-heading font-bold">Summary</h3>
          <div className="markdown pt-2 pb-[44px] text-white-black w-full text-content">
            <Markdown>{markdown}</Markdown>
          </div>
        </div>
      </AppSheet>
      {warm && !warmDone && !isOpen && (
        <AppSheet
          disableScrollLocking
          sheetStyle={{ visibility: "hidden", pointerEvents: "none" }}
          isOpen
          onClose={() => {}}
          ariaLabel="Warmup"
          panelClassName="min-h-[30vh] markdown-sheet bg-taskDetal-container"
          containerStyle={{ height: "fit-content" }}
          bodyClassName="p-3 overflow-y-auto text-white-black"
        >
          <div className="flex flex-col">
            <h3 className="text-heading font-bold">Summary</h3>
            <div className="markdown pt-2 pb-[44px] text-white-black w-full text-content">
              <Markdown>{markdown}</Markdown>
            </div>
          </div>
        </AppSheet>
      )}
    </>
  );
};
