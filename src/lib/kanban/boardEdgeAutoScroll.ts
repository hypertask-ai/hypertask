
export const BOARD_EDGE_SCROLL_ZONE_PX = 120;
export const BOARD_EDGE_SCROLL_MAX_SPEED_PX = 26;

export interface BoardEdgeScrollInput {
  pointerX: number;
  viewportWidth: number;
  viewportLeft?: number;
  scrollLeft: number;
  maxScrollLeft: number;
  zone?: number;
  maxSpeed?: number;
}

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

  const activeZone = Math.min(zone, viewportWidth / 4);
  if (activeZone <= 0) return 0;

  const fromLeft = pointerX - viewportLeft;
  const fromRight = viewportLeft + viewportWidth - pointerX;

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
  return overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden";
}
