export const TASK_SWIPE_DURATION_MS = 180;
export const TASK_SWIPE_START_THRESHOLD_PX = 16;

const RELEASE_THRESHOLD_RATIO = 0.35;
const EDGE_RESISTANCE = 0.2;

export type TaskPlaylistItem = {
  projectId: number;
  uniqueIndex: unknown;
};
export type TaskPlaylistBounds = {
  currentIndex: number;
  previousDisabled: boolean;
  nextDisabled: boolean;
};

export const getTaskPlaylistBounds = (
  playlist: TaskPlaylistItem[] | null | undefined,
  current: TaskPlaylistItem,
): TaskPlaylistBounds => {
  const currentIndex = playlist?.findIndex(
    (item) =>
      item.projectId === current.projectId &&
      item.uniqueIndex === current.uniqueIndex,
  ) ?? -1;
  const hasCurrent = Boolean(playlist?.length) && currentIndex >= 0;
  return {
    currentIndex,
    previousDisabled: !hasCurrent || currentIndex === 0,
    nextDisabled: !hasCurrent || currentIndex === (playlist?.length ?? 0) - 1,
  };
};

export type TaskSwipeIntent = "pending" | "horizontal" | "vertical";
export const resolveTaskSwipeIntent = (
  deltaX: number,
  deltaY: number,
): TaskSwipeIntent => {
  const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  if (distance <= TASK_SWIPE_START_THRESHOLD_PX) return "pending";
  return Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
};

export const resistedTaskSwipeOffset = (
  deltaX: number,
  bounds: TaskPlaylistBounds,
) => {
  const beyondStart = deltaX > 0 && bounds.previousDisabled;
  const beyondEnd = deltaX < 0 && bounds.nextDisabled;
  return beyondStart || beyondEnd ? deltaX * EDGE_RESISTANCE : deltaX;
};

export type TaskSwipeNavigation = "previous" | "next";
export const resolveTaskSwipeNavigation = (
  dragX: number,
  viewportWidth: number,
  bounds: TaskPlaylistBounds,
): TaskSwipeNavigation | null => {
  const threshold = Math.max(1, viewportWidth) * RELEASE_THRESHOLD_RATIO;
  if (Math.abs(dragX) < threshold) return null;
  if (dragX > 0 && !bounds.previousDisabled) return "previous";
  if (dragX < 0 && !bounds.nextDisabled) return "next";
  return null;
};

const eventTargetElement = (target: EventTarget | null): Element | null => {
  if (!target || typeof target !== "object") return null;
  const node = target as Node;
  return node.nodeType === 1 ? node as Element : node.parentElement;
};

export const shouldIgnoreTaskSwipeStart = (
  target: EventTarget | null,
  boundary: Element,
) => {
  const targetElement = eventTargetElement(target);
  if (!targetElement || !boundary.contains(targetElement)) return true;
  if (targetElement.closest('input, textarea, [contenteditable="true"]')) {
    return true;
  }

  const view = boundary.ownerDocument.defaultView;
  for (let element: Element | null = targetElement; element; element = element.parentElement) {
    const overflowX = view?.getComputedStyle(element).overflowX;
    if (
      (overflowX === "auto" || overflowX === "scroll") &&
      element.scrollWidth > element.clientWidth
    ) return true;
    if (element === boundary) break;
  }
  return false;
};
