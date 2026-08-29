// Horizontal edge auto-scroll for the Kanban board during a card drag.
//
// @hello-pangea/dnd auto-scrolls only the window and the *closest* scroll
// container of the droppable being dragged over. A task card's droppable is the
// column's own `overflow-y-auto` list, so the board's horizontal scroller
// (`.homepage-container-tag`) is never a candidate and dragging a card to the
// screen edge does nothing — off-screen columns are unreachable (HTPR-5546).
// The pure step function below drives that missing horizontal scroll.

export const BOARD_EDGE_SCROLL_ZONE_PX = 120;
export const BOARD_EDGE_SCROLL_MAX_SPEED_PX = 26;

export interface BoardEdgeScrollInput {
  /** Pointer position in viewport (client) coordinates. */
  pointerX: number;
  /** Width of the scroller's visible box, in the same coordinate space. */
  viewportWidth: number;
  /** Left edge of the scroller's visible box, in client coordinates. */
  viewportLeft?: number;
  scrollLeft: number;
  maxScrollLeft: number;
  zone?: number;
  maxSpeed?: number;
}

/**
 * Pixels to scroll this frame: negative scrolls left, positive right, 0 idles.
 * Always clamped to the remaining scroll range, so it stops at either end.
 */
export function boardEdgeScrollStep({
  pointerX,
  viewportWidth,
  viewportLeft = 0,
  scrollLeft,
  maxScrollLeft,
  zone = BOARD_EDGE_SCROLL_ZONE_PX,
  maxSpeed = BOARD_EDGE_SCROLL_MAX_SPEED_PX,
}: BoardEdgeScrollInput): number {
  if (!(viewportWidth > 0) || !(maxScrollLeft > 0)) return 0;

  // A narrow board (phones, split panes) must not turn into one big hot zone.
  const activeZone = Math.min(zone, viewportWidth / 4);
  if (activeZone <= 0) return 0;

  const fromLeft = pointerX - viewportLeft;
  const fromRight = viewportLeft + viewportWidth - pointerX;

  // Outside the box entirely on one side still counts as "at that edge", which
  // is what makes a drag past the window edge keep scrolling.
  if (fromLeft < activeZone) {
    const remaining = Math.max(0, scrollLeft);
    if (remaining === 0) return 0;
    const intensity = clamp01((activeZone - fromLeft) / activeZone);
    return -Math.min(remaining, Math.ceil(maxSpeed * intensity));
  }

  if (fromRight < activeZone) {
    const remaining = Math.max(0, maxScrollLeft - scrollLeft);
    if (remaining === 0) return 0;
    const intensity = clamp01((activeZone - fromRight) / activeZone);
    return Math.min(remaining, Math.ceil(maxSpeed * intensity));
  }

  return 0;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Whether an element can actually be scrolled horizontally.
 *
 * `scrollWidth - clientWidth` alone is not enough: an `overflow-x: visible`
 * element still reports overflowing content, but assigning `scrollLeft` on it
 * is a silent no-op. The board wrapper is exactly that in the non-rail ("Old
 * Hypertask Design") and mobile layouts, so an overflow-blind check picked a
 * dead element and the drag auto-scroll did nothing there (HTPR-5561).
 *
 * The page scroller is exempt: the document element scrolls even though its
 * computed `overflow-x` is `visible`.
 */
export function canScrollX({
  scrollWidth,
  clientWidth,
  overflowX,
  isPageScroller = false,
}: {
  scrollWidth: number;
  clientWidth: number;
  overflowX: string;
  isPageScroller?: boolean;
}): boolean {
  if (!(scrollWidth - clientWidth > 1)) return false;
  if (isPageScroller) return true;
  // `hidden` still scrolls programmatically (only the scrollbar is suppressed);
  // `visible` and `clip` do not.
  return overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden";
}
