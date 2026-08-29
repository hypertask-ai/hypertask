import { useCallback, useEffect, useRef } from "react";

import { boardEdgeScrollStep, canScrollX } from "@/lib/kanban/boardEdgeAutoScroll";

// Drives the board's horizontal scroll while a card is dragged near the left or
// right edge. @hello-pangea/dnd only auto-scrolls the droppable's closest scroll
// container (the column list) and the window, so without this a card cannot
// reach an off-screen column (HTPR-5546).

const findScroller = (): HTMLElement | null => {
  if (typeof document === "undefined") return null;
  const board = document.getElementById("sectionsContainer");
  const page = document.scrollingElement as HTMLElement | null;
  const candidates: (HTMLElement | null)[] = [
    board?.closest<HTMLElement>(".homepage-container-tag") ?? null,
    board,
    page,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (
      canScrollX({
        scrollWidth: candidate.scrollWidth,
        clientWidth: candidate.clientWidth,
        overflowX: getComputedStyle(candidate).overflowX,
        isPageScroller: candidate === page,
      })
    ) {
      return candidate;
    }
  }
  return null;
};

export const useBoardEdgeAutoScroll = () => {
  const pointerX = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const active = useRef(false);

  const stop = useCallback(() => {
    active.current = false;
    pointerX.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (active.current || typeof window === "undefined") return;
    active.current = true;

    const tick = () => {
      if (!active.current) return;
      frame.current = requestAnimationFrame(tick);

      const x = pointerX.current;
      if (x === null) return;
      const scroller = findScroller();
      if (!scroller) return;

      const isPageScroller = scroller === document.scrollingElement;
      const rect = isPageScroller ? null : scroller.getBoundingClientRect();
      const delta = boardEdgeScrollStep({
        pointerX: x,
        viewportWidth: rect ? rect.width : window.innerWidth,
        viewportLeft: rect ? rect.left : 0,
        scrollLeft: scroller.scrollLeft,
        maxScrollLeft: scroller.scrollWidth - scroller.clientWidth,
      });
      if (delta !== 0) scroller.scrollLeft += delta;
    };

    frame.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMouseMove = (event: MouseEvent) => {
      if (active.current) pointerX.current = event.clientX;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (active.current && event.touches.length > 0) {
        pointerX.current = event.touches[0].clientX;
      }
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      stop();
    };
  }, [stop]);

  return { start, stop };
};
