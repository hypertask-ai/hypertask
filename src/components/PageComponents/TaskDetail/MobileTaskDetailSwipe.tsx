"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";

import { useRecoilValue } from "@/lib/state";
import {
  getTaskPlaylistBounds,
  resistedTaskSwipeOffset,
  resolveTaskSwipeIntent,
  resolveTaskSwipeNavigation,
  shouldIgnoreTaskSwipeStart,
  TASK_SWIPE_DURATION_MS,
  type TaskSwipeIntent,
} from "@/lib/taskDetailSwipe";
import { tasksPlayListAtom } from "@/store";

const navigationDistance = () =>
  typeof window === "undefined" ? 1 : Math.max(1, window.innerWidth);

type MobileTaskDetailSwipeProps = {
  children: ReactNode;
  enabled: boolean;
  currentItem: {
    projectId: number;
    uniqueIndex: unknown;
  };
  onNext: () => void;
  onPrevious: () => void;
};

const MobileTaskDetailSwipe = ({
  children,
  enabled,
  currentItem,
  onNext,
  onPrevious,
}: MobileTaskDetailSwipeProps) => {
  const tasksPlayList = useRecoilValue(tasksPlayListAtom);
  const bounds = useMemo(
    () => getTaskPlaylistBounds(tasksPlayList, currentItem),
    [currentItem.projectId, currentItem.uniqueIndex, tasksPlayList],
  );
  const [dragX, setDragX] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    intent: TaskSwipeIntent;
  } | null>(null);
  const rawDragXRef = useRef(0);
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTouchMoveRef = useRef<((event: globalThis.TouchEvent) => void) | null>(null);

  const clearAnimationTimer = useCallback(() => {
    if (!animationTimerRef.current) return;
    clearTimeout(animationTimerRef.current);
    animationTimerRef.current = null;
  }, []);

  const resetSwipe = useCallback(() => {
    clearAnimationTimer();
    touchStartRef.current = null;
    rawDragXRef.current = 0;
    setTransitioning(false);
    setDragX(0);
  }, [clearAnimationTimer]);

  useEffect(() => resetSwipe(), [
    currentItem.projectId,
    currentItem.uniqueIndex,
    resetSwipe,
  ]);
  useEffect(() => clearAnimationTimer, [clearAnimationTimer]);

  const snapBack = () => {
    setTransitioning(true);
    setDragX(0);
    clearAnimationTimer();
    animationTimerRef.current = setTimeout(() => {
      setTransitioning(false);
      animationTimerRef.current = null;
    }, TASK_SWIPE_DURATION_MS);
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const surface = surfaceRef.current;
    if (
      transitioning ||
      (bounds.previousDisabled && bounds.nextDisabled) ||
      !surface ||
      shouldIgnoreTaskSwipeStart(event.target, surface)
    ) {
      touchStartRef.current = null;
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;
    clearAnimationTimer();
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      intent: "pending",
    };
    rawDragXRef.current = 0;
  };

  const handleTouchMove = (event: globalThis.TouchEvent) => {
    const start = touchStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch || transitioning || start.intent === "vertical") return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (start.intent === "pending") {
      start.intent = resolveTaskSwipeIntent(deltaX, deltaY);
      if (start.intent !== "horizontal") return;
    }

    event.preventDefault();
    rawDragXRef.current = deltaX;
    setDragX(resistedTaskSwipeOffset(deltaX, bounds));
  };
  handleTouchMoveRef.current = handleTouchMove;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!enabled || !surface) return;
    const listener = (event: globalThis.TouchEvent) =>
      handleTouchMoveRef.current?.(event);
    surface.addEventListener("touchmove", listener, { passive: false });
    return () => surface.removeEventListener("touchmove", listener);
  }, [enabled]);

  const handleTouchEnd = () => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.intent !== "horizontal" || transitioning) return;

    const rawDragX = rawDragXRef.current;
    rawDragXRef.current = 0;
    const direction = resolveTaskSwipeNavigation(
      rawDragX,
      navigationDistance(),
      bounds,
    );
    if (!direction) {
      snapBack();
      return;
    }

    setTransitioning(true);
    setDragX(direction === "next" ? -navigationDistance() : navigationDistance());
    clearAnimationTimer();
    animationTimerRef.current = setTimeout(() => {
      if (direction === "next") onNext();
      else onPrevious();
      animationTimerRef.current = setTimeout(resetSwipe, TASK_SWIPE_DURATION_MS);
    }, TASK_SWIPE_DURATION_MS);
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
    rawDragXRef.current = 0;
    snapBack();
  };

  if (!enabled) return <>{children}</>;

  return (
    <div className="w-full overflow-x-clip bg-taskDetailPage">
      <div
        ref={surfaceRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        className="w-full"
        style={{
          willChange: dragX === 0 && !transitioning ? undefined : "transform",
          transform: dragX === 0 && !transitioning
            ? undefined
            : `translateX(${dragX}px)`,
          transition: transitioning
            ? `transform ${TASK_SWIPE_DURATION_MS}ms ease`
            : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default MobileTaskDetailSwipe;
