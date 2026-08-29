"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { CommandMode } from "@/models/enums";
import { showCommandsAtom } from "@/store";
import { shouldEnableMobilePullDownCommand } from "./mobileShellVisibility";

const DIRECTION_LOCK_PX = 8;
const OPEN_THRESHOLD_PX = 70;
const MAX_PULL_PX = 100;

type Gesture = {
  startX: number;
  startY: number;
  scroller: HTMLElement;
  direction: "pending" | "vertical";
};

const isInteractiveEditor = (target: Element) =>
  Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], .modal'
    )
  );

const findVerticalScroller = (
  target: HTMLElement,
  shell: HTMLElement
): HTMLElement => {
  let element: HTMLElement | null = target;

  while (element) {
    const { overflowY } = window.getComputedStyle(element);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      element.scrollHeight > element.clientHeight + 1
    ) {
      return element;
    }
    if (element === shell) break;
    element = element.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : shell;
};

const isBoardDragActive = () =>
  Array.from(
    document.querySelectorAll<HTMLStyleElement>("style[data-rfd-dynamic]")
  ).some((style) => style.textContent?.includes("user-select: none"));

const usePullDownCommand = () => {
  const showCommands = useRecoilValue(showCommandsAtom);
  const setShowCommands = useSetRecoilState(showCommandsAtom);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const pullDistanceRef = useRef(0);
  const suppressClickUntil = useRef(0);

  useEffect(() => {
    const reset = () => {
      gesture.current = null;
      pullDistanceRef.current = 0;
      setIsPulling(false);
      setPullDistance(0);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || showCommands.show) return;

      const target = event.target;
      if (!(target instanceof Element) || isInteractiveEditor(target)) return;

      const targetElement =
        target instanceof HTMLElement ? target : target.parentElement;
      if (!targetElement) return;

      const shell = targetElement.closest<HTMLElement>(
        ".mobile-tab-bar-content.mobile-pull-command-enabled"
      );
      if (!shell) return;

      const scroller = findVerticalScroller(targetElement, shell);
      if (scroller.scrollTop > 0) return;

      const touch = event.touches[0];
      gesture.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        scroller,
        direction: "pending",
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const current = gesture.current;
      if (!current) return;
      if (event.touches.length !== 1) {
        reset();
        return;
      }

      if (current.scroller.scrollTop > 0 || isBoardDragActive()) {
        reset();
        return;
      }

      const touch = event.touches[0];
      const dx = touch.clientX - current.startX;
      const dy = touch.clientY - current.startY;

      if (current.direction === "pending") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_LOCK_PX) return;
        if (dy <= 0 || Math.abs(dx) >= Math.abs(dy)) {
          reset();
          return;
        }
        current.direction = "vertical";
        setIsPulling(true);
      }

      const distance = Math.min(Math.max(dy, 0), MAX_PULL_PX);
      pullDistanceRef.current = distance;
      setPullDistance(distance);
    };

    const onTouchEnd = () => {
      const current = gesture.current;
      if (!current) return;

      const committed =
        current.direction === "vertical" &&
        pullDistanceRef.current >= OPEN_THRESHOLD_PX &&
        !isBoardDragActive();

      if (current.direction === "vertical") {
        suppressClickUntil.current = Date.now() + 500;
      }
      reset();

      if (committed) {
        // Commit while the touch gesture is still active so the palette's
        // autofocus can open the mobile keyboard.
        flushSync(() => {
          setShowCommands({ show: true, mode: CommandMode.Command });
        });
      }
    };

    const onClick = (event: MouseEvent) => {
      if (Date.now() >= suppressClickUntil.current) return;
      suppressClickUntil.current = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    document.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchend", onTouchEnd, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchcancel", reset, {
      capture: true,
      passive: true,
    });
    document.addEventListener("click", onClick, true);

    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", reset, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [setShowCommands, showCommands.show]);

  return { isPulling, pullDistance };
};

const MobilePullDownCommand = () => {
  const { isPulling, pullDistance } = usePullDownCommand();
  const progress = useMemo(
    () => Math.min(pullDistance / OPEN_THRESHOLD_PX, 1),
    [pullDistance]
  );

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-1/2 z-[290] text-[#8e9093]"
      style={{
        top: "calc(48px + env(safe-area-inset-top) + 2px)",
        opacity: progress,
        transform: `translate(-50%, ${-8 + progress * 18}px) scale(${
          0.85 + progress * 0.15
        })`,
        transition: isPulling
          ? "none"
          : "opacity 160ms ease-out, transform 160ms ease-out",
      }}
    >
      <MoreHorizontal size={20} strokeWidth={1.75} />
    </div>
  );
};

export default MobilePullDownCommand;
